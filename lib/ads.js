// Copyright (c) 2014 Inando (edit by roccomuso and PLCHome)

// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the "Software"),
// to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sublicense,
// and/or sell copies of the Software, and to permit persons to whom the
// Software is furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
// ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.

// @ts-check
'use strict'

const debug = require('debug')('node-ads')
const net = require('net')
const events = require('events')
const Buffer = require('safe-buffer').Buffer
// @ts-ignore
Buffer.INSPECT_MAX_BYTES = 200

const exportedConnect = (options, cb) => {
  const adsClient = getAdsObject(options)
  adsClient.connect(cb)
  return adsClient
}

exports.connect = exportedConnect

const getAdsObject = options => {
  const ads = {
    connected: false,
    options: parseOptions(options),
    invokeId: 0,
    pending: {},
    symHandlesToRelease: [],
    notificationsToRelease: [],
    notifications: {},
    dataStream: null,
    tcpHeaderSize: 6,
    amsHeaderSize: 32
  }
  const emitter = new events.EventEmitter()
  ads.adsClient = Object.create(emitter)
  ads.adsClient.connect = cb => connect(ads, cb)
  ads.adsClient.end = cb => end(ads, cb)
  ads.adsClient.readDeviceInfo = cb => readDeviceInfo(ads, cb)
  ads.adsClient.read = (handle, cb) => read(ads, handle, cb)
  ads.adsClient.write = (handle, cb) => write(ads, handle, cb)
  ads.adsClient.readState = cb => readState(ads, cb)
  ads.adsClient.notify = (handle, cb) => notify(ads, handle, cb)
  ads.adsClient.releaseNotificationHandles = cb => releaseNotificationHandles(ads, cb)
  ads.adsClient.releaseNotificationHandle = (handle, cb) => releaseNotificationHandle(ads, handle, cb)
  ads.adsClient.writeRead = (handle, cb) => writeReadCommand(ads, handle, cb)
  ads.adsClient.getSymbols = (cb, raw) => getSymbols(ads, cb, raw)
  ads.adsClient.getDatatypes = cb => getDatatypes(ads, cb)
  ads.adsClient.multiRead = (handles, cb) => multiRead(ads, handles, cb)
  ads.adsClient.multiWrite = (handles, cb) => multiWrite(ads, handles, cb)
  ads.adsClient.getHandles = (handles, cb) => getHandles(ads, handles, cb)
  Object.defineProperty(ads.adsClient, 'options', {
    // @ts-ignore
    get options() { return ads.options },
    set options(v) { ads.options = v }
  })
  return ads.adsClient
}

const connect = (ads, cb) => {
  ads.tcpClient = net.connect(ads.options.port, ads.options.host, onConenct => {
    ads.connected = true
    cb.apply(ads.adsClient)
  })
  // ads.tcpClient.setKeepAlive(true)
  ads.tcpClient.setNoDelay(true)
  ads.tcpClient.on('data', data => {
    if (ads.dataStream === null) ads.dataStream = data
    else ads.dataStream = Buffer.concat([ads.dataStream, data])
    checkResponseStream(ads)
  })
  ads.tcpClient.on('timeout', data => {
    ads.connected = false;
    ads.adsClient.emit('timeout', data)
    ads.tcpClient.end()
  })
  ads.tcpClient.on('disconnect', () => {
    ads.connected = false;
    ads.adsClient.emit('disconnect')
    ads.tcpClient.end()
  })
  ads.dataCallback = data => {
    ads.connected = false;
    ads.adsClient.emit('error_', data)
    ads.tcpClient.end()
  }
  ads.tcpClient.on('error', ads.dataCallback)
  debug('Hello')
}

const end = (ads, cb) => {
  ads.tcpClient.removeListener('data', ads.dataCallback)
  releaseSymHandles(ads, () => {
    releaseNotificationHandles(ads, done => {
      if (ads.tcpClient) {
        ads.connected = false
        ads.tcpClient.destroy()
      }
      if (typeof cb !== 'undefined') cb()
    })
  })
}

const ID_READ_DEVICE_INFO = 1
const ID_READ = 2
const ID_WRITE = 3
const ID_READ_STATE = 4
const ID_WRITE_CONTROL = 5
const ID_ADD_NOTIFICATION = 6
const ID_DEL_NOTIFICATION = 7
const ID_NOTIFICATION = 8
const ID_READ_WRITE = 9
const processDataByte = (ads, inByte) => {
  ads._buffer = ads._buffer || []
  ads._buffer.push(inByte)
  const headerSize = ads.tcpHeaderSize + ads.amsHeaderSize
  if (ads._buffer.length > headerSize) {
    const length = ads._buffer.readUInt32LE(26)
    if (ads._buffer.length >= headerSize + length) {
      ads.dataStream = Buffer.from(ads._buffer)
      debug('ads:', ads.dataStream)
      ads._buffer = []
      analyseResponse(ads)
    }
  }
}
const checkResponseStream = ads => {
  if (ads.dataStream !== null) {
    const headerSize = ads.tcpHeaderSize + ads.amsHeaderSize
    if (ads.dataStream.length > headerSize) {
      const length = ads.dataStream.readUInt32LE(26)
      if (ads.dataStream.length >= headerSize + length) analyseResponse(ads)
    }
  }
}

const analyseResponse = ads => {
  const commandId = ads.dataStream.readUInt16LE(22)
  const length = ads.dataStream.readUInt32LE(26)
  const errorId = ads.dataStream.readUInt32LE(30)
  const invokeId = ads.dataStream.readUInt32LE(34)
  logPackage(ads, 'receiving', ads.dataStream, commandId, invokeId)
  emitAdsError(ads, errorId)
  const totHeadSize = ads.tcpHeaderSize + ads.amsHeaderSize
  const data = Buffer.alloc(length)
  ads.dataStream.copy(data, 0, totHeadSize, totHeadSize + length)
  if (ads.dataStream.length > totHeadSize + length) {
    const nextdata = Buffer.alloc(ads.dataStream.length - totHeadSize - length)
    ads.dataStream.copy(nextdata, 0, totHeadSize + length)
    ads.dataStream = nextdata
  } else ads.dataStream = null
  if (commandId === ID_NOTIFICATION) {
    // Special case: Notifications are initialised from the server socket
    getNotificationResult(ads, data)
  } else if (ads.pending[invokeId]) {
    const cb = ads.pending[invokeId].cb
    clearTimeout(ads.pending[invokeId].timeout)
    delete ads.pending[invokeId]
    if (!cb) {
      debug(ads.dataStream, invokeId, commandId)
      throw new Error("Received a response, but I can't find the request")
    }
    switch (commandId) {
      case ID_READ_DEVICE_INFO: getDeviceInfoResult(ads, data, cb); break
      case ID_READ: getReadResult(ads, data, cb); break
      case ID_WRITE: getWriteResult(ads, data, cb); break
      case ID_READ_STATE: getReadStateResult(ads, data, cb); break
      case ID_WRITE_CONTROL: /* writeControl(ads, data, cb); */ break
      case ID_ADD_NOTIFICATION: getAddDeviceNotificationResult(ads, data, cb); break
      case ID_DEL_NOTIFICATION: getDeleteDeviceNotificationResult(ads, data, cb); break
      case ID_READ_WRITE: getWriteReadResult(ads, data, cb); break
      default: throw new Error('Unknown command')
    }
  }
  checkResponseStream(ads)
}

/// //////////////////// ADS FUNCTIONS ///////////////////////

const readDeviceInfo = (ads, cb) => {
  const buf = Buffer.alloc(0)
  const options = {
    commandId: ID_READ_DEVICE_INFO,
    data: buf,
    cb: cb
  }
  runCommand(ads, options)
}

const readState = (ads, cb) => {
  const buf = Buffer.alloc(0)
  const options = {
    commandId: ID_READ_STATE,
    data: buf,
    cb: cb
  }
  runCommand(ads, options)
}

const multiRead = (ads, handles, cb) => {
  getHandles(ads, handles, (err, handles) => {
    if (!err) {
      let countreads = 0
      let readlen = 0
      handles.forEach(handle => {
        if (!handle.err) {
          countreads++
          readlen += handle.totalByteLength + 4
        }
      })
      if (countreads>0) {
        var buf = Buffer.alloc(12*countreads)
        var index = 0
        handles.forEach(function(handle) {
          if (!handle.err){
            buf.writeUInt32LE(handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,index)
            buf.writeUInt32LE(handle.indexOffset || handle.symhandle,index+4)
            buf.writeUInt32LE(handle.totalByteLength,index+8)
            index+=12
          }
        })
        const commandOptions = {
          indexGroup: ADSIGRP.SUMUP_READ,
          indexOffset: countreads,
          writeBuffer: buf,
          readLength: readlen,
          symname: 'multiRead'
        }
        writeReadCommand(ads, commandOptions, (err, result) => {
          if (err) {
            if (typeof cb !== 'undefined') cb(err)
          } else {
            if (result.length > 0) {
              let resultpos = 0
              let handlespos = countreads * 4
              handles.forEach(handle => {
                if (!handle.err) {
                  const adsError = result.readUInt32LE(resultpos)
                  resultpos += 4
                  if (adsError != 0) handle.err = adsError
                  if (handle.totalByteLength > 0) {
                    let integrate = Buffer.alloc(handle.totalByteLength)
                    result.copy(integrate, 0, handlespos, handlespos + handle.totalByteLength)
                    integrateResultInHandle(handle, integrate)
                  }
                  handlespos += handle.totalByteLength
                }
              })
            }
            if (typeof cb !== 'undefined') cb(null, handles)
          }
        })
      } else if (typeof cb !== 'undefined') cb(null, handles)
    } else if (typeof cb !== 'undefined') cb(err)
  })
}

const multiWrite = (ads, handles, cb) => {
  getHandles(ads, handles, (err, handles) => {
    if (!err) {
      let countwrites = 0
      let writelen = 0
      handles.forEach(handle => {
        if (!handle.err) {
          countwrites++
          writelen += 12 + handle.totalByteLength
        }
      })
      if (countwrites>0) {
        var buf = Buffer.alloc(writelen)
        var index = 0
        var valindex = 12*countwrites
        handles.forEach(function(handle) {
          if (!handle.err){
            buf.writeUInt32LE(handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,0)
            buf.writeUInt32LE(handle.indexOffset || handle.symhandle,4)
            buf.writeUInt32LE(handle.totalByteLength,8)
            index+=12
            getBytesFromHandle(handle)
            handle.bytes.copy(buf, valindex, 0, handle.bytes.length)
            valindex += handle.totalByteLength
          }
        })
        const commandOptions = {
          indexGroup: ADSIGRP.SUMUP_WRITE,
          indexOffset: countwrites,
          writeBuffer: buf,
          readLength: countwrites * 4,
          symname: 'multiWrite'
        }
        writeReadCommand(ads, commandOptions, (err, result) => {
          if (err) {
            if (typeof cb !== 'undefined') cb(err)
          } else {
            if (result.length > 0) {
              let resultpos = 0
              handles.forEach(handle => {
                if (!handle.err) {
                  const adsError = result.readUInt32LE(resultpos)
                  resultpos += 4
                  if (adsError != 0) handle.err = adsError
                }
              })
            }
            if (typeof cb !== 'undefined') cb(null, handles)
          }
        })
      } else if (typeof cb !== 'undefined') cb(null, handles)
    } else if (typeof cb !== 'undefined') cb(err)
  })
}

const getHandles = (ads, handles, cb) => {
  let countsymnames = 0
  let buflength = 0
  handles.forEach(handle => {
    handle = parseHandle(handle)
    if (typeof handle.symname !== 'undefined') {
      countsymnames++
      buflength += 17 + handle.symname.length
    }
  })
  if (countsymnames > 0) {
    let buf = Buffer.alloc(buflength)
    let index = 0
    let indexsynname = countsymnames * 16
    handles.forEach(handle => {
      if (typeof handle.symname === 'undefined') {
        handle.symname = handle.indexOffset
      } else {
        let bufsymname = stringToBuffer(handle.symname)
        bufsymname.copy(buf, indexsynname, 0, bufsymname.length)
        indexsynname += bufsymname.length
        buf.writeUInt32LE(ADSIGRP.GET_SYMHANDLE_BYNAME, index + 0)
        buf.writeUInt32LE(0x00000000, index + 4)
        buf.writeUInt32LE(0x00000004, index + 8)
        buf.writeUInt32LE(bufsymname.length, index + 12)
        index += 16
      }
    })
    const commandOptions = {
      indexGroup: ADSIGRP.SUMUP_READWRITE,
      indexOffset: countsymnames,
      writeBuffer: buf,
      readLength: countsymnames * 16,
      symname: 'getMultiHandle'
    }
    writeReadCommand(ads, commandOptions, (err, result) => {
      if (err) {
        if (typeof cb !== 'undefined') cb(err)
      } else {
        if (result.length > 0) {
          let resultpos = 0
          let handlespos = countsymnames * 8
          handles.forEach(handle => {
            if (typeof handle.symname !== 'undefined') {
              const adsError = result.readUInt32LE(resultpos)
              if (adsError) handle.err = adsError
              const symhandlebyte = result.readUInt32LE(resultpos + 4)
              resultpos += 8
              if (symhandlebyte == 4)
                handle.symhandle = result.readUInt32LE(handlespos)
              handlespos += symhandlebyte
              let symHandleToRelease = Buffer.alloc(4)
              symHandleToRelease.writeUInt32LE(handle.symhandle, 0)
              ads.symHandlesToRelease.push(symHandleToRelease)
            }
          })
        }
        if (typeof cb !== 'undefined') cb(null, handles)
      }
    })
  } else if (typeof cb !== 'undefined') cb(null, handles)
}

const read = (ads, handle, cb) => {
  getHandle(ads, handle, (err, handle) => {
    if (!err) {
      const commandOptions = {
        indexGroup: handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,
        indexOffset: handle.indexOffset || handle.symhandle,
        bytelength: handle.totalByteLength,
        symname: handle.symnane
      }
      readCommand(ads, commandOptions, (err, result) => {
        if (result) integrateResultInHandle(handle, result)
        //if (typeof cb !== 'undefined') cb(err, result)
        if (typeof cb !== 'undefined') cb(err, handle)
      })
    } else if (typeof cb !== 'undefined') cb(err)
  })
}

const write = (ads, handle, cb) => {
  getHandle(ads, handle, (err, handle) => {
    if (!err) {
      getBytesFromHandle(handle)
      const commandOptions = {
        indexGroup: handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,
        indexOffset: handle.indexOffset || handle.symhandle,
        bytelength: handle.totalByteLength,
        bytes: handle.bytes,
        symname: handle.symname
      }
      writeCommand(ads, commandOptions, (err, result) => {
        if (result) integrateResultInHandle(handle, result)
        if (typeof cb !== 'undefined') cb(err, handle)
      })
    } else if (typeof cb !== 'undefined') cb(err)
  })
}

const notify = (ads, handle, cb) => {
  getHandle(ads, handle, (err, handle) => {
    if (!err) {
      const commandOptions = {
        indexGroup: handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,
        indexOffset: handle.indexOffset || handle.symhandle,
        bytelength: handle.totalByteLength,
        transmissionMode: handle.transmissionMode,
        maxDelay: handle.maxDelay,
        cycleTime: handle.cycleTime,
        symname: handle.symname
      }
      addNotificationCommand(ads, commandOptions, (res, err, notiHandle) => {
        if (!err) {
          if (ads.options.verbose > 0) debug('Add notiHandle ' + notiHandle)
          handle.notifyHandle = notiHandle
          res.notifications[notiHandle] = handle
        }
        if (typeof cb !== 'undefined') cb(err)
      })
    } else if (typeof cb !== 'undefined') cb(err)
  })
}

const getSymbols = (ads, cb, raw) => {
  const cmdLength = {
    indexGroup: ADSIGRP.SYM_UPLOADINFO2,
    indexOffset: 0x00000000,
    bytelength: 0x30
  }
  let cmdSymbols = {
    indexGroup: ADSIGRP.SYM_UPLOAD,
    indexOffset: 0x00000000
  }
  readCommand(ads, cmdLength, (err, result) => {
    if (!err) {
      const data = result.readInt32LE(4)
      cmdSymbols.bytelength = data
      readCommand(ads, cmdSymbols, (err, result) => {
        let symbols = []
        let initialPos = 0
        if (!err) {
          while (initialPos < result.length) {
            let symbol = {}
            let pos = initialPos
            const readLength = result.readUInt32LE(pos)
            initialPos = initialPos + readLength
            symbol.indexGroup = result.readUInt32LE(pos + 4)
            symbol.indexOffset = result.readUInt32LE(pos + 8)
            symbol.size = result.readUInt32LE(pos + 12)
            // symbol.type = result.readUInt32LE(pos + 16) //ADST_ ...
            // symbol.something = result.readUInt32LE(pos + 20)
            const nameLength = result.readUInt16LE(pos + 24) + 1
            const typeLength = result.readUInt16LE(pos + 26) + 1
            const commentLength = result.readUInt16LE(pos + 28) + 1

            pos += 30

            let nameBuf = Buffer.alloc(nameLength)
            result.copy(nameBuf, 0, pos, pos + nameLength)
            symbol.name = nameBuf.toString('binary', 0, findStringEnd(nameBuf, 0))
            pos += nameLength

            let typeBuf = Buffer.alloc(typeLength)
            result.copy(typeBuf, 0, pos, pos + typeLength)
            symbol.type = typeBuf.toString('binary', 0, findStringEnd(typeBuf, 0))
            pos += typeLength

            let commentBuf = Buffer.alloc(commentLength)
            result.copy(commentBuf, 0, pos, pos + commentLength)
            symbol.comment = commentBuf.toString('binary', 0, findStringEnd(commentBuf, 0))
            pos += commentLength

            if (!raw && symbol.type.indexOf('ARRAY') > -1) {
              let re = /ARRAY[\s]+\[([\-\d]+)\.\.([\-\d]+)\][\s]+of[\s]+(.*)/i
              let m
              if ((m = re.exec(symbol.type)) !== null) {
                if (m.index === re.lastIndex) re.lastIndex++
                let v1 = parseInt(m[1])
                let v2 = parseInt(m[2])
                for (let i = v1; i <= v2; i++) {
                  let newSymbol = JSON.parse(JSON.stringify(symbol))
                  newSymbol.arrayid = i + 0
                  newSymbol.type = `${m[3]}`
                  newSymbol.name += `[${i}]`
                  symbols.push(newSymbol)
                }
              }
            } else symbols.push(symbol)
          }
        }
        if (typeof cb !== 'undefined') cb(err, symbols)
      })
    } else if (typeof cb !== 'undefined') cb(err)
  })
}


const getDatatypes = (ads, cb) => {
  const cmdLength = {
    indexGroup: ADSIGRP.SYM_UPLOADINFO2,
    indexOffset: 0x00000000,
    bytelength: 0x30
  }
  const cmdDatatye = {
    indexGroup: ADSIGRP.SYM_DT_UPLOAD,
    indexOffset: 0x00000000
  }
  readCommand(ads, cmdLength, (err, result) => {
    if (!err) {
      const data = result.readInt32LE(12)
      cmdDatatye.bytelength = data
      readCommand(ads, cmdDatatye, (err, result) => {
        let datatyps = []
        let pos = 0
        if (!err) {
          const getDatatypEntry = (datatyps, result, p, index) => {
            let pos = p
            let datatyp = {}
            datatyps.push(datatyp)
            if (index) datatyp.index = index
            const readLength = result.readUInt32LE(pos)
            datatyp.version = result.readUInt32LE(pos + 4)
            //datatyp.hashValue = result.readUInt32LE(pos+8) //offsGetCode
            //datatyp.typeHashValue = result.readUInt32LE(pos+12) //offsSetCode
            datatyp.size = result.readUInt32LE(pos + 16)
            datatyp.dataType = result.readUInt32LE(pos + 24)
            const flags = result.readUInt32LE(pos + 28)
            if (flags == 2) datatyp.offs = result.readUInt32LE(pos + 20)
            const nameLength = result.readUInt16LE(pos + 32) + 1
            const typeLength = result.readUInt16LE(pos + 34) + 1
            const commentLength = result.readUInt16LE(pos + 36) + 1
            const arrayDim = result.readUInt16LE(pos + 38)
            datatyp.arrayDim = arrayDim
            const subItems = result.readUInt16LE(pos + 40)
            datatyp.subItems = subItems

            pos += 42

            let nameBuf = Buffer.alloc(nameLength)
            result.copy(nameBuf, 0, pos, pos + nameLength)
            datatyp.name = nameBuf.toString('binary', 0, findStringEnd(nameBuf, 0))
            pos += nameLength

            let typeBuf = Buffer.alloc(typeLength)
            result.copy(typeBuf, 0, pos, pos + typeLength)
            datatyp.type = typeBuf.toString('binary', 0, findStringEnd(typeBuf, 0))
            pos += typeLength

            let commentBuf = Buffer.alloc(commentLength)
            result.copy(commentBuf, 0, pos, pos + commentLength)
            datatyp.comment = commentBuf.toString('binary', 0, findStringEnd(commentBuf, 0))
            pos += commentLength

            if (arrayDim > 0) {
              datatyp.array = []
              for (let i = 0; i < arrayDim; i++) {
                datatyp.array[i] = {
                  lBound: result.readInt32LE(pos),
                  elements: result.readInt32LE(pos + 4)
                }
                pos += 8
              }
            }
            if (subItems > 0) {
              datatyp.datatyps = []
              for (let i = 0; i < subItems; i++) pos = getDatatypEntry(datatyp.datatyps, result, pos, i + 1)
            }
            return readLength + p
          }
          while (pos < result.length) pos = getDatatypEntry(datatyps, result, pos)
        }
        if (typeof cb !== 'undefined') cb(err, datatyps)
      })
    } else if (typeof cb !== 'undefined') cb(err)
  })
}

const getHandle = (ads, handle, cb) => {
  handle = parseHandle(handle)
  if (typeof handle.symname === 'undefined') {
    handle.symname = handle.indexOffset
    if (typeof cb !== 'undefined') cb(null, handle)
  } else {
    const buf = stringToBuffer(handle.symname)
    if (typeof handle.symhandle === 'undefined') {
      const commandOptions = {
        indexGroup: ADSIGRP.GET_SYMHANDLE_BYNAME,
        indexOffset: 0x00000000,
        writeBuffer: buf,
        readLength: 4,
        symname: handle.symname
      }
      writeReadCommand(ads, commandOptions, (err, result) => {
        if (err) {
          if (typeof cb !== 'undefined') cb(err)
        } else {
          if (result.length > 0) {
            ads.symHandlesToRelease.push(result)
            handle.symhandle = result.readUInt32LE(0)
            if (typeof cb !== 'undefined') cb(null, handle)
          }
        }
      })
    } else if (typeof cb !== 'undefined') cb(null, handle)
  }
}

const releaseSymHandles = (ads, cb) => {
  if (ads.symHandlesToRelease.length > 0) {
    const symHandle = ads.symHandlesToRelease.shift()
    releaseSymHandle(ads, symHandle, () => releaseSymHandles(ads, cb))
  } else if (typeof cb !== 'undefined') cb()
}

const releaseSymHandle = (ads, symhandle, cb) => {
  if (ads.connected) {
    const commandOptions = {
      indexGroup: ADSIGRP.RELEASE_SYMHANDLE,
      indexOffset: 0x00000000,
      bytelength: symhandle.length,
      bytes: symhandle
    }
    writeCommand(ads, commandOptions, err => {
      if (typeof cb !== 'undefined') cb(err)
    })
  } else if (typeof cb !== 'undefined') cb()
}

const releaseNotificationHandles = (ads, cb) => {
  if (ads.notificationsToRelease.length > 0) {
    const notificationHandle = ads.notificationsToRelease.shift()
    deleteDeviceNotificationCommand(ads, notificationHandle, () => releaseNotificationHandles(ads, cb))
  } else if (typeof cb !== 'undefined') cb()
}

const releaseNotificationHandle = (ads, handle, cb) => {
  if (handle.notifyHandle === 'undefined') throw new Error("The handle doesn't have a notifyHandle!")
  const index = ads.notificationsToRelease.indexOf(handle.notifyHandle)
  if (index > -1) {
    delete ads.notifications[handle.notifyHandle]
    ads.notificationsToRelease.splice(index, 1)
    deleteDeviceNotificationCommand(ads, handle.notifyHandle, () => {
      delete handle.notifyHandle
      if (typeof cb !== 'undefined') cb()
    })
  }
}

/// ///////////////////// COMMANDS ///////////////////////

const readCommand = (ads, commandOptions, cb) => {
  let buf = Buffer.alloc(12)
  buf.writeUInt32LE(commandOptions.indexGroup, 0)
  buf.writeUInt32LE(commandOptions.indexOffset, 4)
  buf.writeUInt32LE(commandOptions.bytelength, 8)
  const options = {
    commandId: ID_READ,
    data: buf,
    cb: cb,
    symname: commandOptions.symname
  }
  runCommand(ads, options)
}

const writeCommand = (ads, commandOptions, cb) => {
  let buf = Buffer.alloc(12 + commandOptions.bytelength)
  buf.writeUInt32LE(commandOptions.indexGroup, 0)
  buf.writeUInt32LE(commandOptions.indexOffset, 4)
  buf.writeUInt32LE(commandOptions.bytelength, 8)
  commandOptions.bytes.copy(buf, 12)
  const options = {
    commandId: ID_WRITE,
    data: buf,
    cb: cb,
    symname: commandOptions.symname
  }
  runCommand(ads, options)
}

const addNotificationCommand = (ads, commandOptions, cb) => {
  let buf = Buffer.alloc(40);
  buf.writeUInt32LE(commandOptions.indexGroup, 0)
  buf.writeUInt32LE(commandOptions.indexOffset, 4)
  buf.writeUInt32LE(commandOptions.bytelength, 8)
  buf.writeUInt32LE(commandOptions.transmissionMode, 12)
  buf.writeUInt32LE(commandOptions.maxDelay, 16)
  buf.writeUInt32LE(commandOptions.cycleTime * 10000, 20)
  buf.writeUInt32LE(0, 24)
  buf.writeUInt32LE(0, 28)
  buf.writeUInt32LE(0, 32)
  buf.writeUInt32LE(0, 36)
  const options = {
    commandId: ID_ADD_NOTIFICATION,
    data: buf,
    cb: cb,
    symname: commandOptions.symname
  }
  runCommand(ads, options)
}

const writeReadCommand = (ads, commandOptions, cb) => {
  let buf = Buffer.alloc(16 + commandOptions.writeBuffer.length)
  buf.writeUInt32LE(commandOptions.indexGroup, 0)
  buf.writeUInt32LE(commandOptions.indexOffset, 4)
  buf.writeUInt32LE(commandOptions.readLength, 8)
  buf.writeUInt32LE(commandOptions.writeBuffer.length, 12)
  commandOptions.writeBuffer.copy(buf, 16)
  const options = {
    commandId: ID_READ_WRITE,
    data: buf,
    cb: cb,
    symname: commandOptions.symname
  }
  runCommand(ads, options)
}

const deleteDeviceNotificationCommand = (ads, notificationHandle, cb) => {
  if (ads.connected) {
    let buf = Buffer.alloc(4)
    buf.writeUInt32LE(notificationHandle, 0)
    const options = {
      commandId: ID_DEL_NOTIFICATION,
      data: buf,
      cb: cb
    }
    runCommand(ads, options)
  } else if (typeof cb !== 'undefined') cb()
}

const runCommand = (ads, options) => {
  const tcpHeaderSize = 6
  const headerSize = 32
  let offset = 0

  if (!options.cb) throw new Error('A command needs a callback function!')

  let header = Buffer.alloc(headerSize + tcpHeaderSize)

  header.writeUInt16LE(0, offset)
  offset += 2  // 2 bytes resserver (=0)

  header.writeUInt32LE(headerSize + options.data.length, offset)
  offset += 4  // 4 bytes length

  let amsNetIdTarget = ads.options.amsNetIdTarget.split('.')
  for (let i = 0; i < amsNetIdTarget.length; i++) {
    if (i >= 6) { throw new Error('Incorrect amsNetIdTarget length!') }
    amsNetIdTarget[i] = parseInt(amsNetIdTarget[i], 10)
    header.writeUInt8(amsNetIdTarget[i], offset)
    offset++  // 6 bytes: amsNetIdTarget
  }

  header.writeUInt16LE(ads.options.amsPortTarget, offset)
  offset += 2  // 2 bytes: amsPortTarget

  let amsNetIdSource = ads.options.amsNetIdSource.split('.')
  for (let i = 0; i < amsNetIdSource.length; i++) {
    if (i >= 6) { throw new Error('Incorrect amsNetIdSource length!') }
    amsNetIdSource[i] = parseInt(amsNetIdSource[i], 10)
    header.writeUInt8(amsNetIdSource[i], offset)
    offset++  // 6 bytes amsNetIdSource
  }

  header.writeUInt16LE(ads.options.amsPortSource, offset)
  offset += 2  // 2 bytes: amsPortTarget

  header.writeUInt16LE(options.commandId, offset)
  offset += 2  // 2 bytes: Command ID

  header.writeUInt16LE(4, offset)
  offset += 2  // 2 bytes: state flags (ads request tcp)

  header.writeUInt32LE(options.data.length, offset)
  offset += 4  // 4 bytes: length of the data

  header.writeUInt32LE(0, offset)
  offset += 4  // 4 bytes: error code

  header.writeUInt32LE(++ads.invokeId, offset)
  offset += 4  // 4 bytes: invoke id

  let buf = Buffer.alloc(tcpHeaderSize + headerSize + options.data.length)
  header.copy(buf, 0, 0)
  options.data.copy(buf, tcpHeaderSize + headerSize, 0)
  ads.pending[ads.invokeId] = {
    cb: options.cb,
    timeout: setTimeout(() => {
      delete ads.pending[ads.invokeId]
      if (typeof options.cb !== 'undefined') options.cb('timeout')
    }, ads.options.timeout || 500)
  }

  logPackage(ads, 'sending', buf, options.commandId, ads.invokeId, options.symname)

  ads.tcpClient.write(buf)
}

/// ////////////////// COMMAND RESULT PARSING ////////////////////////////

const getDeviceInfoResult = (ads, data, cb) => {
  const adsError = data.readUInt32LE(0)
  // emitAdsError(ads, adsError)
  const err = getError(adsError)
  let result = {}
  if (!err) {
    try {
      result = {
        majorVersion: data.readUInt8(4), // <==== "try catch" because => if plc is offline (e.g.: in debug mode) => RangeError: Index out of range
        minorVersion: data.readUInt8(5),
        versionBuild: data.readUInt16LE(6),
        deviceName: data.toString('binary', 8, findStringEnd(data, 8))
      }
    } catch (error) {
      if (typeof cb !== 'undefined') cb(err, result)
    }
  }
  if (typeof cb !== 'undefined') cb(err, result)
}

const getReadResult = (ads, data, cb) => {
  const adsError = data.readUInt32LE(0)
  // emitAdsError(ads, adsError)
  const err = getError(adsError)
  let result
  if (!err) {
    const bytelength = data.readUInt32LE(4)
    result = Buffer.alloc(bytelength)
    data.copy(result, 0, 8, 8 + bytelength)
  }
  console.log(result)
  if (typeof cb !== 'undefined') cb(err, result)
}

const getWriteReadResult = (ads, data, cb) => {
  const adsError = data.readUInt32LE(0)
  // emitAdsError(ads, adsError)
  const err = getError(adsError)
  let result
  if (!err) {
    const bytelength = data.readUInt32LE(4)
    result = Buffer.alloc(bytelength)
    data.copy(result, 0, 8, 8 + bytelength)
  }
  if (typeof cb !== 'undefined') cb(err, result)
}

const getWriteResult = (ads, data, cb) => {
  const adsError = data.readUInt32LE(0)
  const err = getError(adsError)
  // emitAdsError(ads, adsError)
  if (typeof cb !== 'undefined') cb(err)
}

const getReadStateResult = (ads, data, cb) => {
  const adsError = data.readUInt32LE(0)
  // emitAdsError(ads, adsError)
  const err = getError(adsError)
  let result
  if (!err) {
    result = {
      adsState: data.readUInt16LE(4),
      deviceState: data.readUInt16LE(6)
    }
  }
  if (typeof cb !== 'undefined') cb(err, result)
}

const getAddDeviceNotificationResult = (ads, data, cb) => {
  const adsError = data.readUInt32LE(0)
  // emitAdsError(ads, adsError)
  const err = getError(adsError)
  let notificationHandle
  if (!err) {
    notificationHandle = data.readUInt32LE(4)
    ads.notificationsToRelease.push(notificationHandle)
  }
  if (typeof cb !== 'undefined') cb(err, notificationHandle)
}

const getDeleteDeviceNotificationResult = (ads, data, cb) => {
  const adsError = data.readUInt32LE(0)
  // emitAdsError(ads, adsError)
  const err = getError(adsError)
  if (typeof cb !== 'undefined') cb(err)
}

const getNotificationResult = (ads, data) => {
  //let timestamp
  const stamps = data.readUInt32LE(4)
  let offset = 8

  for (let i = 0; i < stamps; i++) {
    //timestamp = data.readUInt32LE(offset) // TODO 8 bytes and convert
    offset += 8
    const samples = data.readUInt32LE(offset)
    offset += 4
    for (let j = 0; j < samples; j++) {
      const notiHandle = data.readUInt32LE(offset)
      offset += 4
      const size = data.readUInt32LE(offset)
      offset += 4
      let buf = Buffer.alloc(size)
      data.copy(buf, 0, offset)
      offset += size
      if (ads.options.verbose > 0) debug('Get notiHandle ' + notiHandle)
      const handle = ads.notifications[notiHandle]

      // It can happen that there is a notification before I
      // even have the notification handle.
      // In that case I just skip this notification.
      if (handle !== undefined) {
        integrateResultInHandle(handle, buf)
        ads.adsClient.emit('notification', handle)
      } else if (ads.options.verbose > 0) debug('skipping notification ' + notiHandle)
    }
  }
}

/// ///////////////// HELPERS /////////////////////////////////////////

const stringToBuffer = someString => {
  someString = someString.toString()
  let buf = Buffer.alloc(someString.length + 1)
  buf.write(someString)
  buf[someString.length] = 0
  return buf
}

const parseOptions = options => {
  // Defaults
  if (typeof options.port === 'undefined') options.port = 48898
  if (typeof options.amsPortSource === 'undefined') options.amsPortSource = 32905
  if (typeof options.amsPortTarget === 'undefined') options.amsPortTarget = 801
  if (typeof options.timeout === 'undefined') options.timeout = 500
  if (typeof options.host === 'undefined') throw new Error('host not defined!')
  if (typeof options.amsNetIdTarget === 'undefined') throw new Error('amsNetIdTarget not defined!')
  if (typeof options.amsNetIdSource === 'undefined') throw new Error('amsNetIdTarget not defined!')
  if (options.verbose === undefined) options.verbose = 0
  return options
}

const getCommandDescription = commandId => {
  switch (commandId) {
    case ID_READ_DEVICE_INFO: return 'Read device info'
    case ID_READ: return 'Read'
    case ID_WRITE: return 'Write'
    case ID_READ_STATE: return 'Read state'
    case ID_WRITE_CONTROL: return 'Write control'
    case ID_ADD_NOTIFICATION: return 'Add notification'
    case ID_DEL_NOTIFICATION: return 'Delete notification'
    case ID_NOTIFICATION: return 'Notification'
    case ID_READ_WRITE: return 'ReadWrite'
    default: return 'Unknown command'
  }
}

const getValue = (dataName, result, offset, useLocalTimezone) => {
  switch (dataName) {
    case 'BOOL': return result.readUInt8(offset) != 0
    case 'BYTE':
    case 'USINT': return result.readUInt8(offset)
    case 'SINT': return result.readInt8(offset)
    case 'UINT':
    case 'WORD': return result.readUInt16LE(offset)
    case 'INT': return result.readInt16LE(offset)
    case 'DWORD':
    case 'UDINT': return result.readUInt32LE(offset)
    case 'DINT': return result.readInt32LE(offset)
    case 'REAL': return result.readFloatLE(offset)
    case 'LREAL': return result.readDoubleLE(offset)
    case 'STRING': return result.toString('binary', offset, findStringEnd(result, offset))
    case 'TIME':
    case 'TIME_OF_DAY':
    case 'TOD': {
      const milliseconds = result.readUInt32LE(offset)
      let value = new Date(milliseconds)
      if (useLocalTimezone) {
        let timeoffset = value.getTimezoneOffset()
        value = new Date(value.setMinutes(value.getMinutes() + timeoffset))
      }
      return value
    }
    case 'DATE':
    case 'DATE_AND_TIME':
    case 'DT': {
      const seconds = result.readUInt32LE(offset)
      let value = new Date(seconds * 1000)
      if (useLocalTimezone) {
        let timeoffset = value.getTimezoneOffset()
        value = new Date(value.setMinutes(value.getMinutes() + timeoffset))
      }
      return value
    }
    default: return undefined
  }
}

const integrateResultInHandle = (handle, result) => {
  let offset = 0
  let convert = {}
  for (let i = 0; i < handle.propname.length; i++) {
    getItemByteLength(handle.bytelength[i], convert)
    for (let idx = convert.lowIndex; idx <= convert.hiIndex; idx++) {
      let value = null
      if (result.length >= (offset + convert.length)) {
        if (convert.isAdsType) value = getValue(handle.bytelength[i].name, result, offset, checkUseLocalTimezone(handle, i))
        else value = result.slice(offset, offset + (convert.length))
      }
      if (convert.isAdsArray) setObjectProperty(handle, handle.propname[i] + "[" + idx + "]", value, true)
      else setObjectProperty(handle, handle.propname[i], value, true)
      offset += convert.length
    }
  }
}

const getObjectProperty = (handle, propname) => {
  let result = null
  //let propParts = normalisePropertyExpression(propname)
  normalisePropertyExpression(propname, (err, propParts) => {
    if (!err) {
      let m
      propParts.reduce((obj, key) => {
        result = (typeof obj[key] !== "undefined" ? obj[key] : undefined)
        return result
      }, handle)
    }
  })
  return result
}

const setObjectProperty = (handle, propname, value, createMissing) => {
  if (typeof createMissing === 'undefined') createMissing = (typeof value !== 'undefined')
  //let propParts = normalisePropertyExpression(propname)
  normalisePropertyExpression(propname, (err, propParts) => {
    if (!err) {
      const length = propParts.length
      let obj = handle
      let key
      for (let i = 0; i < length - 1; i++) {
        key = propParts[i]
        if (typeof key === 'string' || (typeof key === 'number' && !Array.isArray(obj))) {
          if (obj.hasOwnProperty(key))
            obj = obj[key]
          else if (createMissing) {
            if (typeof propParts[i + 1] === 'string') obj[key] = {}
            else obj[key] = []
            obj = obj[key]
          } else return null
        } else if (typeof key === 'number') {
          // obj is an array
          if (obj[key] === undefined) {
            if (createMissing) {
              if (typeof propParts[i + 1] === 'string') obj[key] = {}
              else obj[key] = []
              obj = obj[key]
            } else return null
          } else obj = obj[key]
        }
      }
      key = propParts[length - 1]
      if (typeof value === "undefined") {
        if (typeof key === 'number' && Array.isArray(obj)) obj.splice(key, 1)
        else delete obj[key]
      } else obj[key] = value
    }
  })
}

const normalisePropertyExpression = (propname, cb) => {
  const length = propname.length
  if (length === 0) {
    if (typeof cb !== 'undefined') cb("Invalid property expression: zero-length", null)
    return false
  }
  let parts = []
  let start = 0
  let inString = false
  let inBox = false
  let quoteChar
  let v
  for (let i = 0; i < length; i++) {
    const c = propname[i]
    if (!inString) {
      if (c === "'" || c === '"') {
        if (i != start) {
          if (typeof cb !== 'undefined') cb("Invalid property expression: unexpected " + c + " at position " + i, null)
          return false
        }
        inString = true
        quoteChar = c
        start = i + 1
      } else if (c === '.') {
        if (i === 0) {
          if (typeof cb !== 'undefined') cb("Invalid property expression: unexpected . at position 0", null)
          return false
        }
        if (start != i) {
          v = propname.substring(start, i)
          if (/^\d+$/.test(v)) parts.push(parseInt(v))
          else parts.push(v)
        }
        if (i === length - 1) {
          if (typeof cb !== 'undefined') cb("Invalid property expression: unterminated expression", null)
          return false
        }
        // Next char is first char of an identifier: a-z 0-9 $ _
        if (!/[a-z0-9\$\_]/i.test(propname[i + 1])) {
          if (typeof cb !== 'undefined') cb("Invalid property expression: unexpected " + propname[i + 1] + " at position " + (i + 1), null)
          return false
        }
        start = i + 1
      } else if (c === '[') {
        if (i === 0) {
          if (typeof cb !== 'undefined') cb("Invalid property expression: unexpected " + c + " at position " + i, null)
          return false
        }
        if (start != i) {
          parts.push(propname.substring(start, i))
        }
        if (i === length - 1) {
          if (typeof cb !== 'undefined') cb("Invalid property expression: unterminated expression", null)
          return false
        }
        // Next char is either a quote or a number
        if (!/["'\d]/.test(propname[i + 1])) {
          if (typeof cb !== 'undefined') cb("Invalid property expression: unexpected " + propname[i + 1] + " at position " + (i + 1), null)
          return false
        }
        start = i + 1
        inBox = true
      } else if (c === ']') {
        if (!inBox) {
          if (typeof cb !== 'undefined') cb("Invalid property expression: unexpected " + c + " at position " + i, null)
          return false
        }
        if (start != i) {
          v = propname.substring(start, i)
          if (/^\d+$/.test(v)) {
            parts.push(parseInt(v))
          } else {
            if (typeof cb !== 'undefined') cb("Invalid property expression: unexpected array expression at position " + start, null)
            return false
          }
        }
        start = i + 1
        inBox = false
      } else if (c === ' ') {
        if (typeof cb !== 'undefined') cb("Invalid property expression: unexpected ' ' at position " + i, null)
        return false
      }
    } else {
      if (c === quoteChar) {
        if (i - start === 0) {
          if (typeof cb !== 'undefined') cb("Invalid property expression: zero-length string at position " + start, null)
          return false
        }
        parts.push(propname.substring(start, i))
        // If inBox, next char must be a ]. Otherwise it may be [ or .
        if (inBox && !/\]/.test(propname[i + 1])) {
          if (typeof cb !== 'undefined') cb("Invalid property expression: unexpected array expression at position " + start, null)
          return false
        } else if (!inBox && i + 1 !== length && !/[\[\.]/.test(propname[i + 1])) {
          if (typeof cb !== 'undefined') cb("Invalid property expression: unexpected " + propname[i + 1] + " expression at position " + (i + 1), null)
          return false
        }
        start = i + 1
        inString = false
      }
    }
  }
  if (inBox || inString) {
    if (typeof cb !== 'undefined') cb("Invalid property expression: unterminated expression", null)
    return false
  }
  if (start < length) parts.push(propname.substring(start))
  if (typeof cb !== 'undefined') cb(null, parts)
  return true
}

const checkUseLocalTimezone = (handle, i) =>
  (typeof handle.bytelength[i].useLocalTimezone !== 'undefined' ? handle.bytelength[i].useLocalTimezone :
    (typeof handle.useLocalTimezone === 'undefined' || handle.useLocalTimezone))


const parseHandle = handle => {
  if (typeof handle.symname === 'undefined' &&
    (typeof handle.indexGroup === 'undefined' || typeof handle.indexOffset === 'undefined')) {
    throw new Error("The handle doesn't have a symname or an indexGroup and indexOffset property!")
  }
  if (typeof handle.bytelength === 'undefined') handle.bytelength = [makeType('BOOL').length]
  if (typeof handle.propname !== 'undefined') {
    if (!Array.isArray(handle.propname)) handle.propname = [handle.propname]
  } else {
    if (!Array.isArray(handle.bytelength)) handle.propname = ['value']
    else {
      handle.propname = []
      for (let i = 0; i < handle.bytelength.length; i++) handle.propname[i] = `value[${i}]`
    }
  }
  if (!Array.isArray(handle.bytelength)) handle.bytelength = [handle.bytelength]
  if (handle.bytelength.length !== handle.propname.length) throw new Error('The array bytelength and propname should have the same length!')
  handle.totalByteLength = 0
  for (let i = 0; i < handle.bytelength.length; i++) {
    handle.totalByteLength += getItemByteLength(handle.bytelength[i], {})
    normalisePropertyExpression(handle.propname[i], err => { if (err) throw new Error(err) })
  }
  if (typeof handle.transmissionMode === 'undefined') handle.transmissionMode = NOTIFY.ONCHANGE
  if (typeof handle.maxDelay === 'undefined') handle.maxDelay = 0
  if (typeof handle.cycleTime === 'undefined') handle.cycleTime = 10
  return handle
}

const getBytesFromHandle = handle => {
  let p = ''
  let buf = Buffer.alloc(handle.totalByteLength)
  let offset = 0
  let convert = {}
  for (let i = 0; i < handle.propname.length; i++) {
    p = handle.propname[i]
    getItemByteLength(handle.bytelength[i], convert)
    for (let idx = convert.lowIndex; idx <= convert.hiIndex; idx++) {
      let val = getObjectProperty(handle, p)
      if (convert.isAdsArray) val = val[idx]
      if (!convert.isAdsType) val.copy(buf, offset, 0, convert.length)
      if ((typeof val !== 'undefined') && convert.isAdsType && (buf.length >= offset + convert.length)) {
        let datetime
        let timeoffset
        switch (handle.bytelength[i].name) {
          case 'BOOL':
          case 'BYTE':
          case 'USINT':
            buf.writeUInt8(val, offset)
            break
          case 'SINT':
            buf.writeInt8(val, offset)
            break
          case 'UINT':
          case 'WORD':
            buf.writeUInt16LE(val, offset)
            break
          case 'INT':
            buf.writeInt16LE(val, offset)
            break
          case 'DWORD':
          case 'UDINT':
            buf.writeUInt32LE(val, offset)
            break
          case 'DINT':
            buf.writeInt32LE(val, offset)
            break
          case 'REAL':
            buf.writeFloatLE(val, offset)
            break
          case 'LREAL':
            buf.writeDoubleLE(val, offset)
            break
          case 'STRING':
            let stringbuf = Buffer.from(val.toString().slice(0, convert.length - 1) + '\0', 'binary')
            stringbuf.copy(buf, offset)
            break
          case 'TIME':
          case 'TIME_OF_DAY':
          case 'TOD':
            datetime = new Date(val)
            if (checkUseLocalTimezone(handle, i)) {
              timeoffset = datetime.getTimezoneOffset()
              datetime = new Date(datetime.setMinutes(datetime.getMinutes() - timeoffset))
            }
            buf.writeUInt32LE(datetime.getTime(), offset)
            break
          case 'DATE':
          case 'DATE_AND_TIME':
          case 'DT':
            datetime = new Date(val)
            if (checkUseLocalTimezone(handle, i)) {
              timeoffset = datetime.getTimezoneOffset()
              datetime = new Date(datetime.setMinutes(datetime.getMinutes() - timeoffset))
            }
            buf.writeUInt32LE((datetime.getTime() / 1000), offset)
            break
        }
      } else if (typeof val === 'undefined') throw new Error('Property ' + p + ' not available on handle!')
      offset += convert.length
    }
  }
  handle.bytes = buf
}

const getItemByteLength = (bytelength, convert) => {
  convert.isAdsType = false
  convert.isAdsArray = false
  convert.lowIndex = 0
  convert.hiIndex = 0
  convert.arrayElements = 1
  convert.length = 0
  if (typeof bytelength === 'number')
    convert.length = bytelength
  else {
    convert.length = bytelength.length
    if (typeof bytelength.lowIndex !== 'undefined' && typeof bytelength.hiIndex !== 'undefined') {
      convert.arrayElements = (bytelength.hiIndex - bytelength.lowIndex + 1)
      convert.lowIndex = 0
      convert.hiIndex = convert.arrayElements - 1
      convert.isAdsArray = true
    }
    convert.isAdsType = true
  }
  return convert.length * convert.arrayElements
}

const findStringEnd = (data, offset) => {
  if (!offset) { offset = 0 }
  let endpos = offset
  for (let i = offset; i < data.length; i++)
    if (data[i] === 0x00) {
      endpos = i
      break
    }
  return endpos
}

const logPackage = (ads, info, buf, commandId, invokeId, symname) => {
  let msg = `${(info + '').padEnd(10, ' ')} -> commandId: '${commandId}' (${getCommandDescription(commandId)}), invokeId: '${invokeId}'${symname !== undefined ? `, symname: ${symname}` : ''}`
  if (ads.options.verbose > 0) debug(msg)
  if (ads.options.verbose > 1) debug(buf.inspect())
}

const emitAdsError = (ads, errorId) => {
  const err = getError(errorId)
  if (err) ads.adsClient.emit('error_', err)
}

const getError = (ads, errorId) => {
  let error = null
  if (errorId > 0) error = new Error(ERRORS[errorId])
  return error
}

/// /////////////////////////// ADS TYPES /////////////////////////////////

const adsType = {
  length: 1,
  name: ''
}

const makeType = name => {
  let t = Object.create(adsType)
  t.length = typeLength[name]
  t.name = name
  return t
}

exports.makeType = makeType

const exportType = name => {
  let t = makeType(name)
  Object.defineProperty(exports, name, {
    value: t,
    writable: false
  })
}

const typeLength = {
  'BOOL': 1,
  'BYTE': 1,
  'WORD': 2,
  'DWORD': 4,
  'SINT': 1,
  'USINT': 1,
  'INT': 2,
  'UINT': 2,
  'DINT': 4,
  'UDINT': 4,
  'LINT': 8,
  'ULINT': 8,
  'REAL': 4,
  'LREAL': 8,
  'TIME': 4,
  'TIME_OF_DAY': 4,
  'TOD': 4, // TIME_OF_DAY alias
  'DATE': 4,
  'DATE_AND_TIME': 4,
  'DT': 4, // DATE_AND_TIME alias
  'STRING': 81
}

exportType('BOOL')
exportType('BYTE')
exportType('WORD')
exportType('DWORD')
exportType('SINT')
exportType('USINT')
exportType('INT')
exportType('UINT')
exportType('DINT')
exportType('UDINT')
exportType('LINT')
exportType('ULINT')
exportType('REAL')
exportType('LREAL')
// TIME,TIME_OF_DAY,TOD,DATE,DATE_AND_TIME,DT:
// Use handle.useLocalTimezone=false or true to switch it off or on
// default value if useLocalTimezone is not given is on
exportType('TIME')
exportType('TIME_OF_DAY')
exportType('TOD') // TIME_OF_DAY alias
exportType('DATE')
exportType('DATE_AND_TIME')
exportType('DT') // DATE_AND_TIME alias
exportType('STRING')

exports.string = length => {
  let t = {
    length: 81,
    name: 'STRING'
  }
  if (typeof length !== 'undefined') t.length = length + 1
  return t
}

exports.array = (typ, lowIndex, hiIndex) => {
  let t = Object.assign({}, typ)
  if (typeof lowIndex !== 'undefined' &&
    typeof hiIndex !== 'undefined' &&
    lowIndex <= hiIndex) {
    t.lowIndex = lowIndex
    t.hiIndex = hiIndex
  }
  return t
}

exports.useLocalTimezone = (typ, use) => {
  let t = Object.assign({}, typ)
  t.useLocalTimezone = typeof use === 'undefined' || use
  return t
}

const ERRORS = {
  0: 'OK',
  1: 'Internal error',
  2: 'No Rtime',
  3: 'Allocation locked memory error',
  4: 'Insert mailbox error',
  5: 'Wrong receive HMSG',
  6: 'target port not found',
  7: 'target machine not found',
  8: 'Unknown command ID',
  9: 'Bad task ID',
  10: 'No IO',
  11: 'Unknown AMS command',
  12: 'Win 32 error',
  13: 'Port not connected',
  14: 'Invalid AMS length',
  15: 'Invalid AMS Net ID',
  16: 'Low Installation level',
  17: 'No debug available',
  18: 'Port disabled',
  19: 'Port already connected',
  20: 'AMS Sync Win32 error',
  21: 'AMS Sync Timeout',
  22: 'AMS Sync AMS error',
  23: 'AMS Sync no index map',
  24: 'Invalid AMS port',
  25: 'No memory',
  26: 'TCP send error',
  27: 'Host unreachable',
  1792: 'error class <device error>',
  1793: 'Service is not supported by server',
  1794: 'invalid index group',
  1795: 'invalid index offset',
  1796: 'reading/writing not permitted',
  1797: 'parameter size not correct',
  1798: 'invalid parameter value(s)',
  1799: 'device is not in a ready state',
  1800: 'device is busy',
  1801: 'invalid context (must be in Windows)',
  1802: 'out of memory',
  1803: 'invalid parameter value(s)',
  1804: 'not found (files, ...)',
  1805: 'syntax error in command or file',
  1806: 'objects do not match',
  1807: 'object already exists',
  1808: 'symbol not found',
  1809: 'symbol version invalid',
  1810: 'server is in invalid state',
  1811: 'AdsTransMode not supported',
  1812: 'Notification handle is invalid',
  1813: 'Notification client not registered',
  1814: 'no more notification handles',
  1815: 'size for watch too big',
  1816: 'device not initialized',
  1817: 'device has a timeout',
  1818: 'query interface failed',
  1819: 'wrong interface required',
  1820: 'class ID is invalid',
  1821: 'object ID is invalid',
  1822: 'request is pending',
  1823: 'request is aborted',
  1824: 'signal warning',
  1825: 'invalid array index',
  1826: 'symbol not active -> release handle and try again',
  1827: 'access denied',
  1856: 'Error class <client error>',
  1857: 'invalid parameter at service',
  1858: 'polling list is empty',
  1859: 'var connection already in use',
  1860: 'invoke ID in use',
  1861: 'timeout elapsed',
  1862: 'error in win32 subsystem',
  1863: 'Invalid client timeout value',
  1864: 'ads-port not opened',
  1872: 'internal error in ads sync',
  1873: 'hash table overflow',
  1874: 'key not found in hash',
  1875: 'no more symbols in cache',
  1876: 'invalid response received',
  1877: 'sync port is locked',
}
exports.ERRORS = ERRORS

const NOTIFY = {
  CYCLIC: 3,
  ONCHANGE: 4
}
exports.NOTIFY = NOTIFY

const ADSSTATE = {
  INVALID: 0,
  IDLE: 1,
  RESET: 2,
  INIT: 3,
  START: 4,
  RUN: 5,
  STOP: 6,
  SAVECFG: 7,
  LOADCFG: 8,
  POWERFAILURE: 9,
  POWERGOOD: 10,
  ERROR: 11,
  SHUTDOWN: 12,
  SUSPEND: 13,
  RESUME: 14,
  CONFIG: 15,
  RECONFIG: 16,
  STOPPING: 17,
  fromId: (adsstates, id) => {
    let adsstate
    Object.keys(adsstates).map(key => { if (adsstates[key] == id) adsstate = key })
    return adsstate
  }
}
exports.ADSSTATE = ADSSTATE

// ADS reserved index groups
const ADSIGRP = {
  SYMTAB: 0xF000,
  SYMNAME: 0xF001,
  SYMVAL: 0xF002,
  GET_SYMHANDLE_BYNAME: 0xF003, // {TcAdsDef.h: ADSIGRP_SYM_HNDBYNAME}
  READ_SYMVAL_BYNAME: 0xF004, // {TcAdsDef.h: ADSIGRP_SYM_VALBYNAME}
  RW_SYMVAL_BYHANDLE: 0xF005, // {TcAdsDef.h: ADSIGRP_SYM_VALBYHND}
  RELEASE_SYMHANDLE: 0xF006, // {TcAdsDef.h: ADSIGRP_SYM_RELEASEHND}
  SYM_INFOBYNAME: 0xF007,
  SYM_VERSION: 0xF008,
  SYM_INFOBYNAMEEX: 0xF009,
  SYM_DOWNLOAD: 0xF00A,
  SYM_UPLOAD: 0xF00B,
  SYM_UPLOADINFO: 0xF00C,
  SYM_DOWNLOAD2: 0xF00D,
  SYM_DT_UPLOAD: 0xF00E,
  SYM_UPLOADINFO2: 0xF00F,
  SYMNOTE: 0xF010,    // notification of named handle
  SUMUP_READ: 0xF080,    // AdsRW  IOffs list size or 0 (=0 -> list size == WLength/3*sizeof(ULONG))
  // W: {list of IGrp, IOffs, Length}
  // if IOffs != 0 then R: {list of results} and {list of data}
  // if IOffs == 0 then R: only data (sum result)
  SUMUP_WRITE: 0xF081,    // AdsRW  IOffs list size
  // W: {list of IGrp, IOffs, Length} followed by {list of data}
  // R: list of results
  SUMUP_READWRITE: 0xF082,    // AdsRW  IOffs list size
  // W: {list of IGrp, IOffs, RLength, WLength} followed by {list of data}
  // R: {list of results, RLength} followed by {list of data}
  SUMUP_READEX: 0xF083,    // AdsRW  IOffs list size
  // W: {list of IGrp, IOffs, Length}
  SUMUP_READEX2: 0xF084,    // AdsRW  IOffs list size
  // W: {list of IGrp, IOffs, Length}
  // R: {list of results, Length} followed by {list of data (returned lengths)}
  SUMUP_ADDDEVNOTE: 0xF085,    // AdsRW  IOffs list size
  // W: {list of IGrp, IOffs, Attrib}
  // R: {list of results, handles}
  SUMUP_DELDEVNOTE: 0xF086,    // AdsRW  IOffs list size
  // W: {list of handles}
  // R: {list of results, Length} followed by {list of data}
  IOIMAGE_RWIB: 0xF020,    // read/write input byte(s)
  IOIMAGE_RWIX: 0xF021,    // read/write input bit
  IOIMAGE_RISIZE: 0xF025,    // read input size (in byte)
  IOIMAGE_RWOB: 0xF030,    // read/write output byte(s)
  IOIMAGE_RWOX: 0xF031,    // read/write output bit
  IOIMAGE_CLEARI: 0xF040,    // write inputs to null
  IOIMAGE_CLEARO: 0xF050,    // write outputs to null
  IOIMAGE_RWIOB: 0xF060,    // read input and write output byte(s)
  DEVICE_DATA: 0xF100,    // state, name, etc...
}
exports.ADSIGRP = ADSIGRP

const ADSIOFFS_DEVDATA = {
  ADSSTATE: 0x0000, // ads state of device
  DEVSTATE: 0x0002  // device state
}
exports.ADSIOFFS_DEVDATA = ADSIOFFS_DEVDATA
