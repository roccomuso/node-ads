// Copyright (c) 2014 Inando (edit by roccomuso and ChrisHanuta)

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

'use strict'

var debug = require('debug')('node-ads')
var net = require('net')
var events = require('events')
var Buffer = require('safe-buffer').Buffer
Buffer.INSPECT_MAX_BYTES = 200

exports.connect = function (options, cb) {
  var adsClient = getAdsObject(options)
  adsClient.connect(cb)
  return adsClient
}

var getAdsObject = function (options) {
  var ads = {}
  ads.options = parseOptions(options)
  ads.invokeId = 0
  ads.pending = {}
  ads.symHandlesToRelease = []
  ads.notificationsToRelease = []
  ads.notifications = {}
  ads.dataStream = null
  ads.tcpHeaderSize = 6
  ads.amsHeaderSize = 32

  var emitter = new events.EventEmitter()
  ads.adsClient = Object.create(emitter)

  ads.adsClient.connect = function (cb) {
    return connect.call(ads, cb)
  }

  ads.adsClient.end = function (cb) {
    return end.call(ads, cb)
  }

  ads.adsClient.readDeviceInfo = function (cb) {
    return readDeviceInfo.call(ads, cb)
  }

  ads.adsClient.read = function (handle, cb) {
    return read.call(ads, handle, cb)
  }

  ads.adsClient.write = function (handle, cb) {
    return write.call(ads, handle, cb)
  }

  ads.adsClient.readState = function (cb) {
    return readState.call(ads, cb)
  }

  ads.adsClient.notify = function (handle, cb) {
    return notify.call(ads, handle, cb)
  }

  ads.adsClient.releaseNotificationHandles = function (cb) {
    return releaseNotificationHandles.call(ads, cb)
  }
	
  ads.adsClient.writeRead = function (handle, cb) {
    return writeReadCommand.call(ads, handle, cb)
  }
	
  ads.adsClient.getSymbols = function (cb, raw) {
    return getSymbols.call(ads, cb, raw)
  }
	
  ads.adsClient.getDatatyps = function (cb) {
    return getDatatyps.call(ads, cb)
  }

  ads.adsClient.multiRead = function (handles, cb) {
    return multiRead.call(ads, handles, cb)
  }

  ads.adsClient.multiWrite = function (handles, cb) {
    return multiWrite.call(ads, handles, cb)
  }

  ads.adsClient.getHandles = function (handles, cb) {
    return getHandles.call(ads, handles, cb)
  }

  Object.defineProperty(ads.adsClient, 'options', {
    get options () { return ads.options },
    set options (v) { ads.options = v }
  })

  return ads.adsClient
}

var connect = function (cb) {
  var ads = this

  ads.tcpClient = net.connect(
    ads.options.port,
    ads.options.host,
    function () {
      cb.apply(ads.adsClient)
    }
  )

  // ads.tcpClient.setKeepAlive(true)
  ads.tcpClient.setNoDelay(true)

  ads.tcpClient.on('data', function (data) {
    if (ads.dataStream === null) {
      ads.dataStream = data
    } else {
      ads.dataStream = Buffer.concat([ads.dataStream, data])
    }
    checkResponseStream.call(ads)
  })

  ads.tcpClient.on('timeout', function (data) {
    ads.adsClient.emit('timeout', data)
    ads.tcpClient.end()
  })

  ads.dataCallback = function (data) {
    ads.adsClient.emit('error', data)
    ads.tcpClient.end()
  }

  ads.tcpClient.on('error', ads.dataCallback)
}

var end = function (cb) {
  var ads = this
  ads.tcpClient.removeListener('data', ads.dataCallback)
  releaseSymHandles.call(ads, function () {
    releaseNotificationHandles.call(ads, function () {
      if (ads.tcpClient) {
        // ads.tcpClient.end(); // reijo removed
        ads.tcpClient.destroy() // reijo added
      }
      if (cb !== undefined) cb.call(ads)
    })
  })
}

var ID_READ_DEVICE_INFO = 1
var ID_READ = 2
var ID_WRITE = 3
var ID_READ_STATE = 4
var ID_WRITE_CONTROL = 5
var ID_ADD_NOTIFICATION = 6
var ID_DEL_NOTIFICATION = 7
var ID_NOTIFICATION = 8
var ID_READ_WRITE = 9
var processDataByte = function (inByte) {
  var ads = this
  ads._buffer = ads._buffer || []
  ads._buffer.push(inByte)
  var headerSize = ads.tcpHeaderSize + ads.amsHeaderSize
  if (ads._buffer.length > headerSize) {
    var length = ads._buffer.readUInt32LE(26)
    if (ads._buffer.length >= headerSize + length) {
      ads.dataStream = Buffer.from(ads._buffer)
      debug('ads:', ads.dataStream)
      ads._buffer = []
      analyseResponse.call(ads)
    }
  }
}
var checkResponseStream = function () {
  var ads = this
  if (ads.dataStream !== null) {
    var headerSize = ads.tcpHeaderSize + ads.amsHeaderSize
    if (ads.dataStream.length > headerSize) {
      var length = ads.dataStream.readUInt32LE(26)
      if (ads.dataStream.length >= headerSize + length) {
        analyseResponse.call(ads)
      }
    }
  }
}

var analyseResponse = function () {
  var ads = this
  var commandId = ads.dataStream.readUInt16LE(22)
  var length = ads.dataStream.readUInt32LE(26)
  var errorId = ads.dataStream.readUInt32LE(30)
  var invokeId = ads.dataStream.readUInt32LE(34)

  logPackage.call(ads, 'receiving', ads.dataStream, commandId, invokeId)

  emitAdsError.call(ads, errorId)

  var totHeadSize = ads.tcpHeaderSize + ads.amsHeaderSize
  var data = new Buffer(length)
  ads.dataStream.copy(data, 0, totHeadSize, totHeadSize + length)
  if (ads.dataStream.length > totHeadSize + length) {
    var nextdata = new Buffer(ads.dataStream.length - totHeadSize - length)
    ads.dataStream.copy(nextdata, 0, totHeadSize + length)
    ads.dataStream = nextdata
  } else ads.dataStream = null

  if (commandId === ID_NOTIFICATION) {
    // Special case: Notifications are initialised from the server socket
	  getNotificationResult.call(this, data)
  } else if (ads.pending[invokeId]) {
    var cb = ads.pending[invokeId].cb
    clearTimeout(ads.pending[invokeId].timeout)
    delete ads.pending[invokeId]

    if (!cb) {
      debug(ads.dataStream, invokeId, commandId)
      throw new Error("Received a response, but I can't find the request")
    }

    switch (commandId) {
      case ID_READ_DEVICE_INFO:
        getDeviceInfoResult.call(this, data, cb)
        break
      case ID_READ:
        getReadResult.call(this, data, cb)
        break
      case ID_WRITE:
        getWriteResult.call(this, data, cb)
        break
      case ID_READ_STATE:
        getReadStateResult.call(this, data, cb)
        break
      case ID_WRITE_CONTROL:
        // writeControl.call(this, data, cb)
        break
      case ID_ADD_NOTIFICATION:
        getAddDeviceNotificationResult.call(this, data, cb)
        break
      case ID_DEL_NOTIFICATION:
        getDeleteDeviceNotificationResult.call(this, data, cb)
        break
      case ID_READ_WRITE:
        getWriteReadResult.call(this, data, cb)
        break
      default:
        throw new Error('Unknown command')
    }
  }
  checkResponseStream.call(ads)
}

/// //////////////////// ADS FUNCTIONS ///////////////////////

var readDeviceInfo = function (cb) {
  var buf = new Buffer(0)

  var options = {
    commandId: ID_READ_DEVICE_INFO,
    data: buf,
    cb: cb
  }
  runCommand.call(this, options)
}

var readState = function (cb) {
  var buf = new Buffer(0)

  var options = {
    commandId: ID_READ_STATE,
    data: buf,
    cb: cb
  }
  runCommand.call(this, options)
}

var multiRead = function (handles, cb) {
  var ads = this
  getHandles.call(ads, handles, function (err, handles) {
    if (!err) {
      var countreads = 0
      var readlen = 0
      handles.forEach(function(handle) {
        if (!handle.err){
          countreads++
          readlen += handle.totalByteLength+4
        }
      })
      if (countreads>0) {
        var buf = Buffer.alloc(12*countreads)
        var index = 0
        handles.forEach(function(handle) {
          if (!handle.err){
            buf.writeUInt32LE(handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,index)
            buf.writeUInt32LE(handle.symhandle,index+4)
            buf.writeUInt32LE(handle.totalByteLength,index+8)
            index+=12
          }
        })
        var commandOptions = {
          indexGroup: ADSIGRP.SUMUP_READ,
          indexOffset: countreads,
          writeBuffer: buf,
          readLength: readlen,
          symname: 'multiRead'
        }
        writeReadCommand.call(ads, commandOptions, function (err, result) {
          if (err) {
            cb.call(ads.adsClient, err)
          } else {
            if (result.length > 0) {
              var resultpos = 0
              var handlespos = countreads*4
              handles.forEach( function (handle){
                if (!handle.err){
                  var adsError = result.readUInt32LE(resultpos)
                  resultpos+=4
                  if (adsError!=0) {
                    handle.err = adsError
                  }
                  if (handle.totalByteLength>0) {
                    var integrate = Buffer.alloc(handle.totalByteLength)
                    result.copy(integrate,0,handlespos,handlespos+handle.totalByteLength)
                    integrateResultInHandle(handle, integrate)
                  }
                  handlespos+=handle.totalByteLength
                }
              })
            }
            cb.call(ads.adsClient, null, handles)
          }
        })
      } else {
        cb.call(ads.adsClient, null, handles)
      }
    } else {
      cb.call(ads.adsClient, err)
    }
  })
}

var multiWrite = function (handles, cb) {
  var ads = this
  getHandles.call(ads, handles, function (err, handles) {
    if (!err) {
      var countwrites = 0
      var writelen = 0
      handles.forEach(function(handle) {
        if (!handle.err){
          countwrites++
          writelen+=12+handle.totalByteLength
        }
      })
      if (countwrites>0) {
        var buf = Buffer.alloc(writelen)
        var index = 0
        var valindex = 12*countwrites
        handles.forEach(function(handle) {
          if (!handle.err){
            buf.writeUInt32LE(handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,0)
            buf.writeUInt32LE(handle.symhandle,4)
            buf.writeUInt32LE(handle.totalByteLength,8)
            index+=12
            getBytesFromHandle(handle)
            handle.bytes.copy(buf,valindex,0,handle.bytes.length)
            valindex+=handle.totalByteLength
          }
        })
        var commandOptions = {
          indexGroup: ADSIGRP.SUMUP_WRITE,
          indexOffset: countwrites,
          writeBuffer: buf,
          readLength: countwrites*4,
          symname: 'multiWrite'
        }
        writeReadCommand.call(ads, commandOptions, function (err, result) {
          if (err) {
            cb.call(ads.adsClient, err)
          } else {
            if (result.length > 0) {
              var resultpos = 0
              handles.forEach( function (handle){
                if (!handle.err){
                  var adsError = result.readUInt32LE(resultpos)
                  resultpos+=4
                  if (adsError!=0) {
                    handle.err = adsError
                  }
                }
              })
            }
            cb.call(ads.adsClient, null, handles)
          }
        })
      } else {
        cb.call(ads.adsClient, null, handles)
      }
    } else {
      cb.call(ads.adsClient, err)
    }
  })
}

var getHandles = function (handles, cb) {
  var ads = this
  var countsymnames = 0
  var buflength = 0
  handles.forEach( function (handle){
    handle = parseHandle(handle)
    if (typeof handle.symname !== 'undefined') {
      countsymnames++
      buflength+=17+handle.symname.length
    }
  })
  if (countsymnames>0){
    var buf = Buffer.alloc(buflength)
    var index = 0
    var indexsynname = countsymnames*16
    handles.forEach( function (handle){
      if (typeof handle.symname === 'undefined') {
        handle.symname = handle.indexOffset
      } else {
        var bufsymname = stringToBuffer(handle.symname)
        bufsymname.copy(buf,indexsynname,0,bufsymname.length)
        indexsynname+=bufsymname.length
        buf.writeUInt32LE(ADSIGRP.GET_SYMHANDLE_BYNAME,index+0)
        buf.writeUInt32LE(0x00000000,index+4)
        buf.writeUInt32LE(0x00000004,index+8)
        buf.writeUInt32LE(bufsymname.length,index+12)
        index+=16
      }
    })
    var commandOptions = {
      indexGroup: ADSIGRP.SUMUP_READWRITE,
      indexOffset: countsymnames,
      writeBuffer: buf,
      readLength: countsymnames*16,
      symname: 'getMultiHandle'
    }
    writeReadCommand.call(ads, commandOptions, function (err, result) {
      if (err) {
        cb.call(ads.adsClient, err)
      } else {
        if (result.length > 0) {
          var resultpos = 0
          var handlespos = countsymnames*8
          handles.forEach( function (handle){
            if (typeof handle.symname !== 'undefined') {
              var adsError = result.readUInt32LE(resultpos)
              if (adsError) {
                handle.err = adsError
              }
              var symhandlebyte = result.readUInt32LE(resultpos+4)
              resultpos+=8
              if (symhandlebyte==4) {
                handle.symhandle = result.readUInt32LE(handlespos)
              }
              handlespos+=symhandlebyte
              var symHandleToRelease = Buffer.alloc(4)
              symHandleToRelease.writeUInt32LE(handle.symhandle,0)
              ads.symHandlesToRelease.push(symHandleToRelease)
            }
          })
        }
        cb.call(ads.adsClient, null, handles)
      }
    })
  } else cb.call(ads.adsClient, null, handles)
}

var read = function (handle, cb) {
  var ads = this
  getHandle.call(ads, handle, function (err, handle) {
    if (!err) {
      var commandOptions = {
        indexGroup: handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,
        indexOffset: handle.symhandle,
        bytelength: handle.totalByteLength,
        symname: handle.symnane
      }

      readCommand.call(ads, commandOptions, function (err, result) {
        if (result) integrateResultInHandle(handle, result)
        cb.call(ads.adsClient, err, handle)
      })
    } else {
      cb.call(ads.adsClient, err)
    }
  })
}

var write = function (handle, cb) {
  var ads = this
  getHandle.call(ads, handle, function (err, handle) {
    if (!err) {
      getBytesFromHandle(handle)
      var commandOptions = {
        indexGroup: handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,
        indexOffset: handle.symhandle,
        bytelength: handle.totalByteLength,
        bytes: handle.bytes,
        symname: handle.symname
      }

      writeCommand.call(ads, commandOptions, function (err, result) {
        cb.call(ads.adsClient, err)
      })
    } else {
      cb.call(ads.adsClient, err)
    }
  })
}

var notify = function (handle, cb) {
  var ads = this
  getHandle.call(ads, handle, function (err, handle) {
    if (!err) {
      var commandOptions = {
        indexGroup: handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,
        indexOffset: handle.symhandle,
        bytelength: handle.totalByteLength,
        transmissionMode: handle.transmissionMode,
        maxDelay: handle.maxDelay,
        cycleTime: handle.cycleTime,
        symname: handle.symname
      }

      addNotificationCommand.call(ads, commandOptions, function (err, notiHandle) {
        if (!err) {
          if (ads.options.verbose > 0) {
            debug('Add notiHandle ' + notiHandle)
          }

          this.notifications[notiHandle] = handle
        }
        if (typeof cb !== 'undefined') {
          cb.call(ads.adsClient, err)
        }
      })
    } else if (cb) cb.call(ads.adsClient, err)
  })
}

var getSymbols = function (cb, raw) {
  var ads = this
  var cmdLength = {
    indexGroup: ADSIGRP.SYM_UPLOADINFO2,
    indexOffset: 0x00000000,
    bytelength: 0x30
  }

  var cmdSymbols = {
    indexGroup: ADSIGRP.SYM_UPLOAD,
    indexOffset: 0x00000000
  }

  readCommand.call(ads, cmdLength, function (err, result) {
    if (!err) {
      var data = result.readInt32LE(4)
      cmdSymbols.bytelength = data

      readCommand.call(ads, cmdSymbols, function (err, result) {
        var symbols = []
        var initialPos = 0
        if (!err) {
          while (initialPos < result.length) {
            var symbol = {}
            var pos = initialPos 
            var readLength = result.readUInt32LE(pos)
            initialPos = initialPos + readLength
            symbol.indexGroup = result.readUInt32LE(pos + 4)
            symbol.indexOffset = result.readUInt32LE(pos + 8)
            symbol.size = result.readUInt32LE(pos + 12)
            // symbol.type = result.readUInt32LE(pos + 16); //ADST_ ...
            // symbol.something = result.readUInt32LE(pos + 20)
            var nameLength = result.readUInt16LE(pos + 24) + 1
            var typeLength = result.readUInt16LE(pos + 26) + 1
            var commentLength = result.readUInt16LE(pos + 28) + 1

            pos = pos + 30

            var nameBuf = new Buffer(nameLength)
            result.copy(nameBuf, 0, pos, pos + nameLength)
            symbol.name = nameBuf.toString('binary', 0, findStringEnd(nameBuf, 0))
            pos = pos + nameLength

            var typeBuf = new Buffer(typeLength)
            result.copy(typeBuf, 0, pos, pos + typeLength)
            symbol.type = typeBuf.toString('binary', 0, findStringEnd(typeBuf, 0))
            pos = pos + typeLength

            var commentBuf = new Buffer(commentLength)
            result.copy(commentBuf, 0, pos, pos + commentLength)
            symbol.comment = commentBuf.toString('binary', 0, findStringEnd(commentBuf, 0))
            pos = pos + commentLength

            if (!raw && symbol.type.indexOf('ARRAY') > -1) {
              var re = /ARRAY[\s]+\[([\-\d]+)\.\.([\-\d]+)\][\s]+of[\s]+(.*)/i
              var m

              if ((m = re.exec(symbol.type)) !== null) {
                if (m.index === re.lastIndex) {
                  re.lastIndex++
                }

                m[1] = parseInt(m[1])
                m[2] = parseInt(m[2])

                for (var i = m[1]; i <= m[2]; i++) {
                  var newSymbol = JSON.parse(JSON.stringify(symbol))
                  newSymbol.arrayid = i + 0
                  newSymbol.type = m[3] + ''
                  newSymbol.name += '[' + i + ']'
                  symbols.push(newSymbol)
                }
              }
            } else {
              symbols.push(symbol)
            }
          }
        }

        cb.call(ads.adsClient, err, symbols)
      })
    } else {
      cb.call(ads.adsClient, err)
    }
  })
}


var getDatatyps = function (cb) {
  var ads = this
  var cmdLength = {
    indexGroup: ADSIGRP.SYM_UPLOADINFO2,
    indexOffset: 0x00000000,
    bytelength: 0x30
  }

  var cmdDatatye = {
    indexGroup: ADSIGRP.SYM_DT_UPLOAD,
    indexOffset: 0x00000000
  }

  readCommand.call(ads, cmdLength, function (err, result) {
    if (!err) {
      var data = result.readInt32LE(12)
      cmdDatatye.bytelength = data


      readCommand.call(ads, cmdDatatye, function (err, result) {
        var datatyps = []
        var pos = 0
        if (!err) {

          function getDatatypEntry(datatyps,result,p,index) {
            var pos = p
            var datatyp = {}
            datatyps.push(datatyp)
            if (index) {
              datatyp.index = index
            }
            var readLength = result.readUInt32LE(pos)
            datatyp.version = result.readUInt32LE(pos+4)
            //datatyp.hashValue = result.readUInt32LE(pos+8) //offsGetCode
            //datatyp.typeHashValue = result.readUInt32LE(pos+12) //offsSetCode
            datatyp.size = result.readUInt32LE(pos+16)
            datatyp.dataType = result.readUInt32LE(pos+24)
            var flags = result.readUInt32LE(pos+28)
            if (flags==2) {
              datatyp.offs = result.readUInt32LE(pos+20)
            }
            var nameLength = result.readUInt16LE(pos + 32) + 1
            var typeLength = result.readUInt16LE(pos + 34) + 1
            var commentLength = result.readUInt16LE(pos + 36) + 1
            var arrayDim = result.readUInt16LE(pos + 38)
            datatyp.arrayDim = arrayDim
            var subItems = result.readUInt16LE(pos + 40)
            datatyp.subItems = subItems

            pos = pos + 42

            var nameBuf = new Buffer(nameLength)
            result.copy(nameBuf, 0, pos, pos + nameLength)
            datatyp.name = nameBuf.toString('binary', 0, findStringEnd(nameBuf, 0))
            pos = pos + nameLength

            var typeBuf = new Buffer(typeLength)
            result.copy(typeBuf, 0, pos, pos + typeLength)
            datatyp.type = typeBuf.toString('binary', 0, findStringEnd(typeBuf, 0))
            pos = pos + typeLength

            var commentBuf = new Buffer(commentLength)
            result.copy(commentBuf, 0, pos, pos + commentLength)
            datatyp.comment = commentBuf.toString('binary', 0, findStringEnd(commentBuf, 0))
            pos = pos + commentLength

            if (arrayDim>0) {
              datatyp.array = []
              for (var i=0; i<arrayDim;i++){
                datatyp.array[i] = {lBound: result.readInt32LE(pos),
                                   elements: result.readInt32LE(pos+4)
                                  }
                pos = pos+8
              }
            }

            if (subItems>0) {
              datatyp.datatyps = []
              for (var i=0; i<subItems;i++){
                pos = getDatatypEntry(datatyp.datatyps,result,pos,i+1)
              }
            }

            return readLength+p
          }

          while (pos < result.length) {
            pos = getDatatypEntry(datatyps,result,pos)
          }
        }

        cb.call(ads.adsClient, err, datatyps)
      })
    } else {
      cb.call(ads.adsClient, err)
    }
  })
}

var getHandle = function (handle, cb) {
  var ads = this
  handle = parseHandle(handle)
  if (typeof handle.symname === 'undefined') {
    handle.symname = handle.indexOffset
    cb.call(ads, null, handle)
  } else {
    var buf = stringToBuffer(handle.symname)

    if (typeof handle.symhandle === 'undefined') {
      var commandOptions = {
        indexGroup: ADSIGRP.GET_SYMHANDLE_BYNAME,
        indexOffset: 0x00000000,
        writeBuffer: buf,
        readLength: 4,
        symname: handle.symname
      }

      writeReadCommand.call(ads, commandOptions, function (err, result) {
        if (err) {
          cb.call(ads, err)
        } else {
          if (result.length > 0) {
            ads.symHandlesToRelease.push(result)
            handle.symhandle = result.readUInt32LE(0)
            cb.call(ads, null, handle)
          }
        }
      })
    } else cb.call(ads, null, handle)
  }
}

var releaseSymHandles = function (cb) {
  var ads = this
  if (this.symHandlesToRelease.length > 0) {
    var symHandle = this.symHandlesToRelease.shift()
    releaseSymHandle.call(this, symHandle, function () {
      releaseSymHandles.call(ads, cb)
    })
  } else cb.call(this)
}

var releaseSymHandle = function (symhandle, cb) {
  var ads = this
  var commandOptions = {
    indexGroup: ADSIGRP.RELEASE_SYMHANDLE,
    indexOffset: 0x00000000,
    bytelength: symhandle.length,
    bytes: symhandle
  }
  writeCommand.call(this, commandOptions, function (err) {
    cb.call(ads, err)
  })
}

var releaseNotificationHandles = function (cb) {
  var ads = this
  if (this.notificationsToRelease.length > 0) {
    var notificationHandle = this.notificationsToRelease.shift()
    deleteDeviceNotificationCommand.call(this, notificationHandle, function () {
      releaseNotificationHandles.call(ads, cb)
    })
  } else cb.call(this)
}

/// ///////////////////// COMMANDS ///////////////////////

var readCommand = function (commandOptions, cb) {
  var buf = new Buffer(12)
  buf.writeUInt32LE(commandOptions.indexGroup, 0)
  buf.writeUInt32LE(commandOptions.indexOffset, 4)
  buf.writeUInt32LE(commandOptions.bytelength, 8)

  var options = {
    commandId: ID_READ,
    data: buf,
    cb: cb,
    symname: commandOptions.symname
  }
  runCommand.call(this, options)
}

var writeCommand = function (commandOptions, cb) {
  var buf = new Buffer(12 + commandOptions.bytelength)
  buf.writeUInt32LE(commandOptions.indexGroup, 0)
  buf.writeUInt32LE(commandOptions.indexOffset, 4)
  buf.writeUInt32LE(commandOptions.bytelength, 8)
  commandOptions.bytes.copy(buf, 12)

  var options = {
    commandId: ID_WRITE,
    data: buf,
    cb: cb,
    symname: commandOptions.symname
  }
  runCommand.call(this, options)
}

var addNotificationCommand = function (commandOptions, cb) {
  var buf = new Buffer(40)
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

  var options = {
    commandId: ID_ADD_NOTIFICATION,
    data: buf,
    cb: cb,
    symname: commandOptions.symname
  }
  runCommand.call(this, options)
}

var writeReadCommand = function (commandOptions, cb) {
  var buf = new Buffer(16 + commandOptions.writeBuffer.length)
  buf.writeUInt32LE(commandOptions.indexGroup, 0)
  buf.writeUInt32LE(commandOptions.indexOffset, 4)
  buf.writeUInt32LE(commandOptions.readLength, 8)
  buf.writeUInt32LE(commandOptions.writeBuffer.length, 12)
  commandOptions.writeBuffer.copy(buf, 16)

  var options = {
    commandId: ID_READ_WRITE,
    data: buf,
    cb: cb,
    symname: commandOptions.symname
  }
  runCommand.call(this, options)
}

var deleteDeviceNotificationCommand = function (notificationHandle, cb) {
  var buf = new Buffer(4)
  buf.writeUInt32LE(notificationHandle, 0)

  var options = {
    commandId: ID_DEL_NOTIFICATION,
    data: buf,
    cb: cb
  }
  runCommand.call(this, options)
}

var runCommand = function (options) {
  var tcpHeaderSize = 6
  var headerSize = 32
  var offset = 0

  if (!options.cb) {
    throw new Error('A command needs a callback function!')
  }

  var header = new Buffer(headerSize + tcpHeaderSize)

  // 2 bytes resserver (=0)
  header.writeUInt16LE(0, offset)
  offset += 2

  // 4 bytes length
  header.writeUInt32LE(headerSize + options.data.length, offset)
  offset += 4

  // 6 bytes: amsNetIdTarget
  var amsNetIdTarget = this.options.amsNetIdTarget.split('.')
  for (var i = 0; i < amsNetIdTarget.length; i++) {
    if (i >= 6) { throw new Error('Incorrect amsNetIdTarget length!') }
    amsNetIdTarget[i] = parseInt(amsNetIdTarget[i], 10)
    header.writeUInt8(amsNetIdTarget[i], offset)
    offset++
  }

  // 2 bytes: amsPortTarget
  header.writeUInt16LE(this.options.amsPortTarget, offset)
  offset += 2

  // 6 bytes amsNetIdSource
  var amsNetIdSource = this.options.amsNetIdSource.split('.')
  for (i = 0; i < amsNetIdSource.length; i++) {
    if (i >= 6) { throw new Error('Incorrect amsNetIdSource length!') }
    amsNetIdSource[i] = parseInt(amsNetIdSource[i], 10)
    header.writeUInt8(amsNetIdSource[i], offset)
    offset++
  }

  // 2 bytes: amsPortTarget
  header.writeUInt16LE(this.options.amsPortSource, offset)
  offset += 2

  // 2 bytes: Command ID
  header.writeUInt16LE(options.commandId, offset)
  offset += 2

  // 2 bytes: state flags (ads request tcp)
  header.writeUInt16LE(4, offset)
  offset += 2

  // 4 bytes: length of the data
  header.writeUInt32LE(options.data.length, offset)
  offset += 4

  // 4 bytes: error code
  header.writeUInt32LE(0, offset)
  offset += 4

  // 4 bytes: invoke id
  header.writeUInt32LE(++this.invokeId, offset)
  offset += 4

  var buf = new Buffer(tcpHeaderSize + headerSize + options.data.length)
  header.copy(buf, 0, 0)
  options.data.copy(buf, tcpHeaderSize + headerSize, 0)

  this.pending[this.invokeId] = {cb: options.cb,
    timeout: setTimeout(function () {
      delete this.pending[this.invokeId]

      options.cb('timeout')
    }.bind(this), 500)}

  logPackage.call(this, 'sending', buf, options.commandId, this.invokeId, options.symname)

  this.tcpClient.write(buf)
}

/// ////////////////// COMMAND RESULT PARSING ////////////////////////////

var getDeviceInfoResult = function (data, cb) {
  var adsError = data.readUInt32LE(0)
  // emitAdsError.call(this, adsError)
  var err = getError(adsError)
  var result

  if (!err) {
    result = {
      majorVersion: data.readUInt8(4),
      minorVersion: data.readUInt8(5),
      versionBuild: data.readUInt16LE(6),
      deviceName: data.toString('binary', 8, findStringEnd(data, 8))
    }
  }

  cb.call(this.adsClient, err, result)
}

var getReadResult = function (data, cb) {
  var adsError = data.readUInt32LE(0)
  var result
  // emitAdsError.call(this, adsError)
  var err = getError(adsError)
  if (!err) {
    var bytelength = data.readUInt32LE(4)
    result = new Buffer(bytelength)
    data.copy(result, 0, 8, 8 + bytelength)
  }
  cb.call(this, err, result)
}

var getWriteReadResult = function (data, cb) {
  var adsError = data.readUInt32LE(0)
  var result
  // emitAdsError.call(this, adsError)
  var err = getError(adsError)
  if (!err) {
    var bytelength = data.readUInt32LE(4)
    result = new Buffer(bytelength)
    data.copy(result, 0, 8, 8 + bytelength)
  }
  cb.call(this, err, result)
}

var getWriteResult = function (data, cb) {
  var adsError = data.readUInt32LE(0)
  var err = getError(adsError)
  // emitAdsError.call(this, adsError)
  cb.call(this, err)
}

var getReadStateResult = function (data, cb) {
  var adsError = data.readUInt32LE(0)
    // emitAdsError.call(this, adsError)
  var err = getError(adsError)
  var result
  if (!err) {
    result = {
      adsState: data.readUInt16LE(4),
      deviceState: data.readUInt16LE(6)
    }
  }

  cb.call(this.adsClient, err, result)
}

var getAddDeviceNotificationResult = function (data, cb) {
  var adsError = data.readUInt32LE(0)
  var notificationHandle
  // emitAdsError.call(this, adsError)
  var err = getError(adsError)
  if (!err) {
    notificationHandle = data.readUInt32LE(4)
    this.notificationsToRelease.push(notificationHandle)
  }
  cb.call(this, err, notificationHandle)
}

var getDeleteDeviceNotificationResult = function (data, cb) {
  var adsError = data.readUInt32LE(0)
  // emitAdsError.call(this, adsError)
  var err = getError(adsError)
  cb.call(this, err)
}

var getNotificationResult = function (data) {
  var length = data.readUInt32LE(0)
  var stamps = data.readUInt32LE(4)
  var offset = 8
  var timestamp = 0
  var samples = 0
  var notiHandle = 0
  var size = 0

  for (var i = 0; i < stamps; i++) {
    timestamp = data.readUInt32LE(offset) // TODO 8 bytes and convert
    offset += 8
    samples = data.readUInt32LE(offset)
    offset += 4
    for (var j = 0; j < samples; j++) {
      notiHandle = data.readUInt32LE(offset)
      offset += 4
      size = data.readUInt32LE(offset)
      offset += 4
      var buf = new Buffer(size)
      data.copy(buf, 0, offset)
      offset += size

      if (this.options.verbose > 0) {
        debug('Get notiHandle ' + notiHandle)
      }

      var handle = this.notifications[notiHandle]

      // It can happen that there is a notification before I
      // even have the notification handle.
      // In that case I just skip this notification.
      if (handle !== undefined) {
        integrateResultInHandle(handle, buf)
        this.adsClient.emit('notification', handle)
      } else {
        if (this.options.verbose > 0) {
          debug('skipping notification ' + notiHandle)
        }
      }
    }
  }
}

/// ///////////////// HELPERS /////////////////////////////////////////

var stringToBuffer = function (someString) {
  var buf = new Buffer(someString.length + 1)
  buf.write(someString)
  buf[someString.length] = 0
  return buf
}

var parseOptions = function (options) {
  // Defaults
  if (typeof options.port === 'undefined') {
    options.port = 48898
  }

  if (typeof options.amsPortSource === 'undefined') {
    options.amsPortSource = 32905
  }

  if (typeof options.amsPortTarget === 'undefined') {
    options.amsPortTarget = 801
  }

  if (typeof options.host === 'undefined') {
    throw new Error('host not defined!')
  }

  if (typeof options.amsNetIdTarget === 'undefined') {
    throw new Error('amsNetIdTarget not defined!')
  }

  if (typeof options.amsNetIdSource === 'undefined') {
    throw new Error('amsNetIdTarget not defined!')
  }

  if (options.verbose === undefined) {
    options.verbose = 0
  }

  return options
}

var getCommandDescription = function (commandId) {
  var desc = 'Unknown command'
  switch (commandId) {
    case ID_READ_DEVICE_INFO:
      desc = 'Read device info'
      break
    case ID_READ:
      desc = 'Read'
      break
    case ID_WRITE:
      desc = 'Write'
      break
    case ID_READ_STATE:
      desc = 'Read state'
      break
    case ID_WRITE_CONTROL:
      desc = 'Write control'
      break
    case ID_ADD_NOTIFICATION:
      desc = 'Add notification'
      break
    case ID_DEL_NOTIFICATION:
      desc = 'Delete notification'
      break
    case ID_NOTIFICATION:
      desc = 'Notification'
      break
    case ID_READ_WRITE:
      desc = 'ReadWrite'
      break
  }
  return desc
}
var getValue = function (dataName, result, offset, useLocalTimezone) {
  var value
  var timeoffset
  switch (dataName) {
    case 'BOOL':
      value = result.readUInt8(offset) != 0
      break
    case 'BYTE':
    case 'USINT':
      value = result.readUInt8(offset)
      break
    case 'SINT':
      value = result.readInt8(offset)
      break
    case 'UINT':
    case 'WORD':
      value = result.readUInt16LE(offset)
      break
    case 'INT':
      value = result.readInt16LE(offset)
      break
    case 'DWORD':
    case 'UDINT':
      value = result.readUInt32LE(offset)
      break
    case 'DINT':
      value = result.readInt32LE(offset)
      break
    case 'REAL':
      value = result.readFloatLE(offset)
      break
    case 'LREAL':
      value = result.readDoubleLE(offset)
      break
    case 'STRING':
      value = result.toString('binary', offset, findStringEnd(result, offset))
      break
    case 'TIME':
    case 'TIME_OF_DAY':
    case 'TOD':
      var milliseconds = result.readUInt32LE(offset)
      value = new Date(milliseconds)
      if (useLocalTimezone) {
        timeoffset = value.getTimezoneOffset()
        value = new Date(value.setMinutes(value.getMinutes() + timeoffset))
      }
      break
    case 'DATE':
    case 'DATE_AND_TIME':
    case 'DT':
      var seconds = result.readUInt32LE(offset)
      value = new Date(seconds * 1000)
      if (useLocalTimezone) {
        timeoffset = value.getTimezoneOffset()
        value = new Date(value.setMinutes(value.getMinutes() + timeoffset))
      }
      break
  }
  return value
}
var integrateResultInHandle = function (handle, result) {
  var offset = 0
  var convert = {}
  for (var i = 0; i < handle.propname.length; i++) {
    getItemByteLength(handle.bytelength[i], convert)

    for (var idx = convert.lowIndex; idx <= convert.hiIndex; idx++){

      var value = null
      if (result.length >= (offset+convert.length)) {
        if (convert.isAdsType) {
          value = getValue(handle.bytelength[i].name, result, offset, checkUseLocalTimezone(handle,i))
        } else {
          value = result.slice(offset, offset + (convert.length))
        }
      }

      if (convert.isAdsArray) {
        setObjectProperty(handle,handle.propname[i]+"["+idx+"]",value,true)
      } else {
        setObjectProperty(handle,handle.propname[i],value,true)
      }

      offset += convert.length
    }
  }
}

function getObjectProperty(handle,propname) {
  var result = null
  //var propParts = normalisePropertyExpression(propname)
  normalisePropertyExpression(propname,function(err,propParts) {
    if (!err) {
      var m
      propParts.reduce(function(obj, key) {
        result = (typeof obj[key] !== "undefined" ? obj[key] : undefined)
        return result
      }, handle)
    }
  })
  return result
}

function setObjectProperty(handle,propname,value,createMissing) {
  if (typeof createMissing === 'undefined') {
    createMissing = (typeof value !== 'undefined')
  }
  //var propParts = normalisePropertyExpression(propname)
  normalisePropertyExpression(propname,function(err,propParts) {
    if (!err) {
      var depth = 0
      var length = propParts.length
      var obj = handle
      var key
      for (var i=0;i<length-1;i++) {
        key = propParts[i]
        if (typeof key === 'string' || (typeof key === 'number' && !Array.isArray(obj))) {
          if (obj.hasOwnProperty(key)) {
            obj = obj[key]
          } else if (createMissing) {
            if (typeof propParts[i+1] === 'string') {
              obj[key] = {}
            } else {
              obj[key] = []
            }
            obj = obj[key]
          } else {
            return null
          }
        } else if (typeof key === 'number') {
          // obj is an array
          if (obj[key] === undefined) {
            if (createMissing) {
              if (typeof propParts[i+1] === 'string') {
                obj[key] = {}
              } else {
                obj[key] = []
              }
              obj = obj[key]
            } else {
              return null
            }
          } else {
            obj = obj[key]
          }
        }
      }
      key = propParts[length-1]
      if (typeof value === "undefined") {
        if (typeof key === 'number' && Array.isArray(obj)) {
          obj.splice(key,1)
        } else {
          delete obj[key]
        }
      } else {
        obj[key] = value
      }
    }
  })
}

function normalisePropertyExpression(propname,cb) {
  var length = propname.length
  if (length === 0) {
    cb("Invalid property expression: zero-length",null)
    return false
  }
  var parts = []
  var start = 0
  var inString = false
  var inBox = false
  var quoteChar
  var v
  for (var i=0;i<length;i++) {
    var c = propname[i]
    if (!inString) {
      if (c === "'" || c === '"') {
        if (i != start) {
          cb("Invalid property expression: unexpected "+c+" at position "+i,null)
          return false
        }
        inString = true
        quoteChar = c
        start = i+1
      } else if (c === '.') {
        if (i===0) {
          cb("Invalid property expression: unexpected . at position 0",null)
          return false
        }
        if (start != i) {
          v = propname.substring(start,i)
          if (/^\d+$/.test(v)) {
            parts.push(parseInt(v))
          } else {
            parts.push(v)
          }
        }
        if (i===length-1) {
          cb("Invalid property expression: unterminated expression",null)
          return false
        }
        // Next char is first char of an identifier: a-z 0-9 $ _
        if (!/[a-z0-9\$\_]/i.test(propname[i+1])) {
          cb("Invalid property expression: unexpected "+propname[i+1]+" at position "+(i+1),null)
          return false
        }
        start = i+1
      } else if (c === '[') {
        if (i === 0) {
          cb("Invalid property expression: unexpected "+c+" at position "+i,null)
          return false
        }
        if (start != i) {
          parts.push(propname.substring(start,i))
        }
        if (i===length-1) {
          cb("Invalid property expression: unterminated expression",null)
          return false
        }
        // Next char is either a quote or a number
        if (!/["'\d]/.test(propname[i+1])) {
          cb("Invalid property expression: unexpected "+propname[i+1]+" at position "+(i+1),null)
          return false
        }
        start = i+1
        inBox = true
      } else if (c === ']') {
        if (!inBox) {
          cb("Invalid property expression: unexpected "+c+" at position "+i,null)
          return false
        }
        if (start != i) {
          v = propname.substring(start,i)
          if (/^\d+$/.test(v)) {
            parts.push(parseInt(v))
          } else {
            cb("Invalid property expression: unexpected array expression at position "+start,null)
            return false
          }
        }
        start = i+1
        inBox = false
      } else if (c === ' ') {
        cb("Invalid property expression: unexpected ' ' at position "+i,null)
        return false
      }
    } else {
      if (c === quoteChar) {
        if (i-start === 0) {
          cb("Invalid property expression: zero-length string at position "+start,null)
          return false
        }
        parts.push(propname.substring(start,i))
        // If inBox, next char must be a ]. Otherwise it may be [ or .
        if (inBox && !/\]/.test(propname[i+1])) {
          cb("Invalid property expression: unexpected array expression at position "+start,null)
          return false
        } else if (!inBox && i+1!==length && !/[\[\.]/.test(propname[i+1])) {
          cb("Invalid property expression: unexpected "+propname[i+1]+" expression at position "+(i+1),null)
          return false
        }
        start = i+1
        inString = false
      }
    }
  }
  if (inBox || inString) {
    cb("Invalid property expression: unterminated expression",null)
    return false
  }
  if (start < length) {
    parts.push(propname.substring(start))
  }
  cb(null,parts)
  return true
}

var checkUseLocalTimezone = function (handle,idx) {
  return (typeof handle.bytelength[idx].useLocalTimezone !== 'undefined'? handle.bytelength[idx].useLocalTimezone :
         (typeof handle.useLocalTimezone === 'undefined' || handle.useLocalTimezone))
}

var parseHandle = function (handle) {
  if (typeof handle.symname === 'undefined' &&
      (typeof handle.indexGroup === 'undefined' || typeof handle.indexOffset === 'undefined') ) {
    throw new Error("The handle doesn't have a symname or an indexGroup and indexOffset property!")
  }

  if (typeof handle.bytelength === 'undefined') {
    handle.bytelength = [exports.BOOL]
  }

  if (typeof handle.propname !== 'undefined') {
    if (!Array.isArray(handle.propname)) {
      handle.propname = [handle.propname]
    }
  } else {
    if (!Array.isArray(handle.bytelength)) {
      handle.propname = ['value']
    } else {
      handle.propname = []
      for (var i = 0; i < handle.bytelength.length; i++) {
        handle.propname[i] = 'value['+i+']'
      }
    }
  }

  if (!Array.isArray(handle.bytelength)) {
    handle.bytelength = [handle.bytelength]
  }

  if (handle.bytelength.length !== handle.propname.length) {
    throw new Error('The array bytelength and propname should have the same length!')
  }

  handle.totalByteLength = 0
  for (var i = 0; i < handle.bytelength.length; i++) {
    handle.totalByteLength += getItemByteLength(handle.bytelength[i],{})
    normalisePropertyExpression(handle.propname[i], function(err) {
      if (err) {
        throw new Error(err)
      }
    });
  }

  if (typeof handle.transmissionMode === 'undefined') {
    handle.transmissionMode = exports.NOTIFY.ONCHANGE
  }

  if (typeof handle.maxDelay === 'undefined') {
    handle.maxDelay = 0
  }

  if (typeof handle.cycleTime === 'undefined') {
    handle.cycleTime = 10
  }

  return handle
}

var getBytesFromHandle = function (handle) {
  var p = ''
  var buf = new Buffer(handle.totalByteLength)
  var offset = 0
  var convert = {}
  for (var i = 0; i < handle.propname.length; i++) {
    p = handle.propname[i]
    getItemByteLength(handle.bytelength[i], convert)

    for (var idx = convert.lowIndex; idx <= convert.hiIndex; idx++) {

      var val = getObjectProperty(handle,p)
      if (convert.isAdsArray) {
        val = val[idx]
      }

      if (!convert.isAdsType) {
        val.copy(buf, offset,0,convert.length)
      }

      if ((typeof val !== 'undefined') && convert.isAdsType && (buf.length >= offset+convert.length)) {
        var datetime
        var timeoffset
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
            var stringbuf = new Buffer(val.toString().slice(0,convert.length-1) + '\0', 'binary')
            stringbuf.copy(buf, offset)
            break
          case 'TIME':
          case 'TIME_OF_DAY':
          case 'TOD':
            datetime = new Date(val)
            if (checkUseLocalTimezone(handle,i)) {
              timeoffset = datetime.getTimezoneOffset()
              datetime = new Date(datetime.setMinutes(datetime.getMinutes() - timeoffset))
            }
            buf.writeUInt32LE( datetime.getTime(), offset)
            break
          case 'DATE':
          case 'DATE_AND_TIME':
          case 'DT':
            datetime = new Date(val)
            if (checkUseLocalTimezone(handle,i)) {
              timeoffset = datetime.getTimezoneOffset()
              datetime = new Date(datetime.setMinutes(datetime.getMinutes() - timeoffset))
            }
            buf.writeUInt32LE((datetime.getTime() / 1000), offset)
            break
        }
      } else if (typeof val === 'undefined') throw new Error('Property ' + p + ' not available on handle!')
      offset+=convert.length
    }
  }

  handle.bytes = buf
}

var getItemByteLength = function (bytelength, convert) {
  convert.isAdsType = false
  convert.isAdsArray = false
  convert.lowIndex = 0
  convert.hiIndex = 0
  convert.arrayElements = 1
  convert.length = 0
  if (typeof bytelength === 'number') {
    convert.length = bytelength
  } else {
    convert.length = bytelength.length
    if (typeof bytelength.lowIndex !== 'undefined' &&
        typeof bytelength.hiIndex !== 'undefined') {
      convert.arrayElements = (bytelength.hiIndex-bytelength.lowIndex+1)
      convert.lowIndex = 0
      convert.hiIndex = convert.arrayElements -1
      convert.isAdsArray = true
    }
    convert.isAdsType = true
  }
  return (convert.length * convert.arrayElements)
}

var findStringEnd = function (data, offset) {
  if (!offset) { offset = 0 }
  var endpos = offset
  for (var i = offset; i < data.length; i++) {
    if (data[i] === 0x00) {
      endpos = i
      break
    }
  }
  return endpos
}

var logPackage = function (info, buf, commandId, invokeId, symname) {
  while (info.length < 10) info = info + ' '

  var msg = info + ' -> commandId: ' + commandId
  msg += ' (' + getCommandDescription(commandId) + ') '

  msg += ', invokeId: ' + invokeId

  if (symname !== undefined) {
    msg += ' symname: ' + symname
  }

  if (this.options.verbose > 0) {
    debug(msg)
  }

  if (this.options.verbose > 1) {
    debug(buf.inspect())
    // debug(buf)
  }
}

var emitAdsError = function (errorId) {
  var err = getError(errorId)
  if (err) {
    this.adsClient.emit('error', err)
  }
}

var getError = function (errorId) {
  var error = null
  if (errorId > 0) {
    error = new Error(ERRORS[errorId])
  }
  return error
}

/// /////////////////////////// ADS TYPES /////////////////////////////////

var adsType = {
  length: 1,
  name: ''
}

exports.makeType = function (name) {
  var t = Object.create(adsType)
  t.length = typeLength[name]
  t.name = name
  return t
}

function exportType (name) {
  var t = exports.makeType(name)
  Object.defineProperty(exports, name, {
    value: t,
    writable: false
  })
}

var typeLength = {
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

exports.string = function (length) {
  var t = {
    length: 81,
    name: 'STRING'
  }

  if (typeof length !== 'undefined') {
    t.length = arguments[0]+1
  }
  return t
}

exports.array = function (typ,lowIndex,hiIndex) {
  var t = Object.assign({},typ)
  if (typeof lowIndex !== 'undefined' &&
      typeof hiIndex !== 'undefined' &&
      lowIndex <= hiIndex) {
    t.lowIndex = lowIndex
    t.hiIndex = hiIndex
  }
  return t
}

exports.useLocalTimezone = function (typ,use) {
  var t = Object.assign({},typ)
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

exports.NOTIFY = {
  CYCLIC: 3,
  ONCHANGE: 4
}

const ADSSTATE = {
  INVALID:      0,
  IDLE:         1,
  RESET:        2,
  INIT:         3,
  START:        4,
  RUN:          5,
  STOP:         6,
  SAVECFG:      7,
  LOADCFG:      8,
  POWERFAILURE: 9,
  POWERGOOD:    10,
  ERROR:        11,
  SHUTDOWN:     12,
  SUSPEND:      13,
  RESUME:       14,
  CONFIG:       15,
  RECONFIG:     16,
  STOPPING:     17,
  fromId: function(id) {
    var adsstates = this
    var adsstate
    Object.keys(adsstates).map(function(key){if (adsstates[key]==id) adsstate=key})
    return adsstate
  }
}
exports.ADSSTATE = ADSSTATE

// ADS reserved index groups
var ADSIGRP = {
  SYMTAB:               0xF000,
  SYMNAME:              0xF001,
  SYMVAL:               0xF002,
  GET_SYMHANDLE_BYNAME: 0xF003, // {TcAdsDef.h: ADSIGRP_SYM_HNDBYNAME}
  READ_SYMVAL_BYNAME:   0xF004, // {TcAdsDef.h: ADSIGRP_SYM_VALBYNAME}
  RW_SYMVAL_BYHANDLE:   0xF005, // {TcAdsDef.h: ADSIGRP_SYM_VALBYHND}
  RELEASE_SYMHANDLE:    0xF006, // {TcAdsDef.h: ADSIGRP_SYM_RELEASEHND}
  SYM_INFOBYNAME:       0xF007,
  SYM_VERSION:          0xF008,
  SYM_INFOBYNAMEEX:     0xF009,
  SYM_DOWNLOAD:         0xF00A,
  SYM_UPLOAD:           0xF00B,
  SYM_UPLOADINFO:       0xF00C,
  SYM_DOWNLOAD2:        0xF00D,
  SYM_DT_UPLOAD:        0xF00E,
  SYM_UPLOADINFO2:      0xF00F,
  SYMNOTE:              0xF010,    // notification of named handle
  SUMUP_READ:           0xF080,    // AdsRW  IOffs list size or 0 (=0 -> list size == WLength/3*sizeof(ULONG))
                      // W: {list of IGrp, IOffs, Length}
                      // if IOffs != 0 then R: {list of results} and {list of data}
                      // if IOffs == 0 then R: only data (sum result)
  SUMUP_WRITE:          0xF081,    // AdsRW  IOffs list size
                      // W: {list of IGrp, IOffs, Length} followed by {list of data}
                      // R: list of results
  SUMUP_READWRITE:      0xF082,    // AdsRW  IOffs list size
                      // W: {list of IGrp, IOffs, RLength, WLength} followed by {list of data}
                      // R: {list of results, RLength} followed by {list of data}
  SUMUP_READEX:         0xF083,    // AdsRW  IOffs list size
                      // W: {list of IGrp, IOffs, Length}
  SUMUP_READEX2:        0xF084,    // AdsRW  IOffs list size
                      // W: {list of IGrp, IOffs, Length}
                      // R: {list of results, Length} followed by {list of data (returned lengths)}
  SUMUP_ADDDEVNOTE:     0xF085,    // AdsRW  IOffs list size
                      // W: {list of IGrp, IOffs, Attrib}
                      // R: {list of results, handles}
  SUMUP_DELDEVNOTE:     0xF086,    // AdsRW  IOffs list size
                      // W: {list of handles}
                      // R: {list of results, Length} followed by {list of data}
  IOIMAGE_RWIB:         0xF020,    // read/write input byte(s)
  IOIMAGE_RWIX:         0xF021,    // read/write input bit
  IOIMAGE_RISIZE:       0xF025,    // read input size (in byte)
  IOIMAGE_RWOB:         0xF030,    // read/write output byte(s)
  IOIMAGE_RWOX:         0xF031,    // read/write output bit
  IOIMAGE_CLEARI:       0xF040,    // write inputs to null
  IOIMAGE_CLEARO:       0xF050,    // write outputs to null
  IOIMAGE_RWIOB:        0xF060,    // read input and write output byte(s)
  DEVICE_DATA:          0xF100,    // state, name, etc...
}
exports.ADSIGRP = ADSIGRP

exports.ADSIOFFS_DEVDATA = {
  ADSSTATE:             0x0000, // ads state of device
  DEVSTATE:             0x0002  // device state
}
