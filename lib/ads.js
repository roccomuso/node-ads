// Copyright (c) 2018 src-one

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

'use strict';

var debug = require('debug')('node-ads');
var net = require('net');
var events = require('events');
var Buffer = require('safe-buffer').Buffer;

var helpers = require('./helpers');
const {
  ID,
  ERRORS,
  NOTIFY,
  ADSSTATE,
  ADSIGRP,
  ADSIOFFS_DEVDATA
} = require('./values');

Buffer.INSPECT_MAX_BYTES = 200;

exports.connect = function (options, callback) {
  var adsClient = getAdsObject(options);
  adsClient.connect(callback);

  return adsClient;
};

var getAdsObject = function (options) {
  var ads = {};
  ads.options = helpers.parseOptions(options);
  ads.invokeId = 0;
  ads.pending = {};
  ads.symHandlesToRelease = [];
  ads.notificationsToRelease = [];
  ads.notifications = {};
  ads.dataStream = null;
  ads.tcpHeaderSize = 6;
  ads.amsHeaderSize = 32;

  var emitter = new events.EventEmitter();
  ads.adsClient = Object.create(emitter);

  ads.adsClient.connect = function (callback) {
    return connect.call(ads, callback);
  };

  ads.adsClient.end = function (callback) {
    return end.call(ads, callback);
  };

  ads.adsClient.readDeviceInfo = function (callback) {
    return readDeviceInfo.call(ads, callback);
  };

  ads.adsClient.read = function (handle, callback) {
    return read.call(ads, handle, callback);
  };

  ads.adsClient.write = function (handle, callback) {
    return write.call(ads, handle, callback);
  };

  ads.adsClient.readState = function (callback) {
    return readState.call(ads, callback);
  };

  ads.adsClient.notify = function (handle, callback) {
    return notify.call(ads, handle, callback);
  };

  ads.adsClient.writeRead = function (handle, callback) {
    return writeReadCommand.call(ads, handle, callback);
  };

  ads.adsClient.getSymbols = function (callback) {
    return getSymbols.call(ads, callback);
  };

  ads.adsClient.multiRead = function (handles, callback) {
    return multiRead.call(ads, handles, callback);
  };

  ads.adsClient.multiWrite = function (handles, callback) {
    return multiWrite.call(ads, handles, callback)
  }

  ads.adsClient.getHandles = function (handles, callback) {
    return getHandles.call(ads, handles, callback);
  };

  Object.defineProperty(ads.adsClient, 'options', {
    get options() {
      return ads.options;
    },
    set options(value) {
      ads.options = value;
    }
  });

  return ads.adsClient;
};

var connect = function (callback) {
  var ads = this;

  ads.tcpClient = net.connect(
    ads.options.port,
    ads.options.host,
    function () {
      callback.apply(ads.adsClient)
    }
  );

  // ads.tcpClient.setKeepAlive(true);
  ads.tcpClient.setNoDelay(true);

  ads.tcpClient.on('data', function (data) {
    if (ads.dataStream === null) {
      ads.dataStream = data;
    } else {
      ads.dataStream = Buffer.concat([ads.dataStream, data]);
    }
    checkResponseStream.call(ads);
  });

  ads.tcpClient.on('timeout', function (data) {
    ads.adsClient.emit('timeout', data)
    ads.tcpClient.end()
  })

  ads.dataCallback = function (data) {
    ads.adsClient.emit('error', data);
    ads.tcpClient.end();
  };

  ads.tcpClient.on('error', ads.dataCallback);
};

var end = function (callback) {
  var ads = this;

  ads.tcpClient.removeListener('data', ads.dataCallback);

  releaseSymHandles.call(ads, function () {
    releaseNotificationHandles.call(ads, function () {
      if (ads.tcpClient) {
        // ads.tcpClient.end()
        ads.tcpClient.destroy();
      }

      if (callback !== undefined) {
        callback.call(ads);
      }
    });
  });
}

var processDataByte = function (inByte) {
  var ads = this;

  ads._buffer = ads._buffer || [];
  ads._buffer.push(inByte);

  var headerSize = ads.tcpHeaderSize + ads.amsHeaderSize;

  if (ads._buffer.length > headerSize) {
    var length = ads._buffer.readUInt32LE(26);

    if (ads._buffer.length >= headerSize + length) {
      ads.dataStream = Buffer.from(ads._buffer);
      debug('ads:', ads.dataStream);
      ads._buffer = [];
      analyseResponse.call(ads);
    }
  }
};

var checkResponseStream = function () {
  var ads = this;

  if (ads.dataStream !== null) {
    var headerSize = ads.tcpHeaderSize + ads.amsHeaderSize;
    if (ads.dataStream.length > headerSize) {
      var length = ads.dataStream.readUInt32LE(26);

      if (ads.dataStream.length >= headerSize + length) {
        analyseResponse.call(ads);
      }
    }
  }
};

var analyseResponse = function () {
  var ads = this;

  var commandId = ads.dataStream.readUInt16LE(22);
  var length = ads.dataStream.readUInt32LE(26);
  var errorId = ads.dataStream.readUInt32LE(30);
  var invokeId = ads.dataStream.readUInt32LE(34);

  helpers.logPackage.call(ads, 'receiving', ads.dataStream, commandId, invokeId);

  helpers.emitAdsError.call(ads, errorId);

  var totHeadSize = ads.tcpHeaderSize + ads.amsHeaderSize;
  var data = Buffer.alloc(length);

  ads.dataStream.copy(data, 0, totHeadSize, totHeadSize + length);

  if (ads.dataStream.length > totHeadSize + length) {
    var nextdata = Buffer.alloc(ads.dataStream.length - totHeadSize - length);

    ads.dataStream.copy(nextdata, 0, totHeadSize + length);
    ads.dataStream = nextdata;
  } else {
    ads.dataStream = null;
  }

  if (commandId === ID.NOTIFICATION) {
    // Special case: Notifications are initialised from the server socket
    getNotificationResult.call(this, data);
  } else if (ads.pending[invokeId]) {
    var callback = ads.pending[invokeId].callback;

    clearTimeout(ads.pending[invokeId].timeout);
    delete ads.pending[invokeId];

    if (!callback) {
      debug(ads.dataStream, invokeId, commandId);
      throw new Error('Received a response, but the request can\'t be found');
    }

    switch (commandId) {
      case ID.READ_DEVICE_INFO:
        getDeviceInfoResult.call(this, data, callback);
        break;
      case ID.READ:
        getReadResult.call(this, data, callback);
        break;
      case ID.WRITE:
        getWriteResult.call(this, data, callback);
        break;
      case ID.READ_STATE:
        getReadStateResult.call(this, data, callback);
        break;
      case ID.WRITE_CONTROL:
        // writeControl.call(this, data, callback);
        break;
      case ID.ADD_NOTIFICATION:
        getAddDeviceNotificationResult.call(this, data, callback);
        break;
      case ID.DEL_NOTIFICATION:
        getDeleteDeviceNotificationResult.call(this, data, callback);
        break;
      case ID.READ_WRITE:
        getWriteReadResult.call(this, data, callback);
        break;
      default:
        throw new Error('Unknown command');
    }
  }

  checkResponseStream.call(ads);
}

/////////////////////// ADS FUNCTIONS ///////////////////////

var readDeviceInfo = function (callback) {
  var buf = Buffer.alloc(0);

  var options = {
    commandId: ID.READ_DEVICE_INFO,
    data: buf,
    callback: callback,
  };

  runCommand.call(this, options);
};

var readState = function (callback) {
  var buf = Buffer.alloc(0);

  var options = {
    commandId: ID.READ_STATE,
    data: buf,
    callback: callback,
  };

  runCommand.call(this, options);
};

var multiRead = function (handles, callback) {
  var ads = this;
  var readLength = 0;

  getHandles.call(ads, handles, function (error, handles) {
    if (!error) {
      var buf = Buffer.alloc(handles.length * 12);

      handles.forEach(function (handle, index) {
        buf.writeUInt32LE(handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE, index * 12 + 0);
        buf.writeUInt32LE(handle.symHandle, index * 12 + 4);
        buf.writeUInt32LE(handle.byteLength.length, index * 12 + 8);

        readLength += handle.byteLength.length + 4;
      });
    }

    var request = {
      indexGroup: ADSIGRP.SUMUP_READ,
      indexOffset: handles.length,
      writeBuffer: buf,
      readLength: readLength,
      symName: 'multiRead',
    };

    writeReadCommand.call(ads, request, function (error, result) {
      if (error) {
        callback.call(ads, error);
      } else {
        if (result && result.length > 0) {
          var resultpos = 0;
          var handlespos = handles.length * 4;

          handles.forEach(function (handle) {
            if (!handle.error) {
              var adsError = result.readUInt32LE(resultpos);
              resultpos += 4;

              if (adsError != 0) {
                handle.error = adsError;
              }

              if (handle.totalByteLength > 0) {
                var integrate = Buffer.alloc(handle.totalByteLength);

                result.copy(integrate, 0, handlespos, handlespos + handle.totalByteLength);
                helpers.integrateResultInHandle(handle, integrate);
              }

              handlespos += handle.totalByteLength;
            }
          });
        }

        callback.call(ads.adsClient, error, handles);
      }
    });
  });
};

var multiWrite = function (handles, callback) {
  var ads = this;
  var valData = [];

  getHandles.call(ads, handles, function (error, handles) {
    if (!error) {
      var writelen = 0;

      handles.forEach(function (handle) {
        if (!handle.error) {
          writelen += 12 + handle.totalByteLength;
        }
      });

      if (handles.length > 0) {
        var buf = Buffer.alloc(writelen);
        var valIndex = 12 * handles.length;

        handles.forEach(function (handle, index) {
          if (!handle.err) {
            buf.writeUInt32LE(handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE, index * 12 + 0);
            buf.writeUInt32LE(handle.symHandle, index * 12 + 4);
            buf.writeUInt32LE(handle.totalByteLength, index * 12 + 8);

            helpers.getBytesFromHandle(handle);

            handle.bytes.copy(buf, valIndex, 0, handle.bytes.length);
            valData.push(handle.bytes);
            valIndex += handle.totalByteLength;
          }
        });

        var request = {
          indexGroup: ADSIGRP.SUMUP_WRITE,
          indexOffset: handles.length,
          writeBuffer: buf,
          readLength: handles.length * 4,
          symName: 'multiWrite',
        };

        writeReadCommand.call(ads, request, function (error, result) {
          if (error) {
            callback.call(ads.adsClient, error);
          } else {
            if (result && result.length > 0) {
              var resultpos = 0;

              handles.forEach(function (handle) {
                if (!handle.err) {
                  var adsError = result.readUInt32LE(resultpos);
                  resultpos += 4;

                  if (adsError != 0) {
                    handle.err = adsError;
                  }
                }
              });
            }

            callback.call(ads.adsClient, null, handles);
          }
        })
      } else {
        callback.call(ads.adsClient, null, handles);
      }
    } else {
      callback.call(ads.adsClient, error);
    }
  });
};

var read = function (handle, callback) {
  var ads = this;

  getHandle.call(ads, handle, function (error, handle) {
    if (!error) {
      var commandOptions = {
        indexGroup: handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,
        indexOffset: handle.symHandle,
        byteLength: handle.totalByteLength,
        symName: handle.symName,
      };

      if (typeof handle.arrayid !== 'undefined') {
        commandOptions += handle.totalByteLength * handle.arrayid;
      }

      readCommand.call(ads, commandOptions, function (error, result) {
        if (result) {
          helpers.integrateResultInHandle(handle, result);
        }

        callback.call(ads.adsClient, error, handle);
      })
    } else {
      callback.call(ads.adsClient, error);
    }
  });
};

var write = function (handle, callback) {
  var ads = this;

  getHandle.call(ads, handle, function (error, handle) {
    if (!error) {
      helpers.getBytesFromHandle(handle);

      var commandOptions = {
        indexGroup: handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,
        indexOffset: handle.symHandle,
        byteLength: handle.totalByteLength,
        bytes: handle.bytes,
        symName: handle.symName,
      };

      if (typeof handle.arrayid !== 'undefined') {
        commandOptions += handle.totalByteLength * handle.arrayid;
      }

      writeCommand.call(ads, commandOptions, function (error, result) {
        callback.call(ads.adsClient, error, result);
      });
    } else {
      callback.call(ads.adsClient, error);
    }
  });
};

var notify = function (handle, callback) {
  var ads = this;

  getHandle.call(ads, handle, function (error, handle) {
    if (!error) {
      var commandOptions = {
        indexGroup: handle.indexGroup || ADSIGRP.RW_SYMVAL_BYHANDLE,
        indexOffset: handle.symHandle,
        byteLength: handle.totalByteLength,
        transmissionMode: handle.transmissionMode,
        maxDelay: handle.maxDelay,
        cycleTime: handle.cycleTime,
        symName: handle.symName,
      };

      addNotificationCommand.call(ads, commandOptions, function (error, notiHandle) {
        if (ads.options.verbose > 0) {
          debug('Add notiHandle ' + notiHandle);
        }

        this.notifications[notiHandle] = handle;

        if (typeof callback !== 'undefined') {
          callback.call(ads.adsClient, error);
        }
      });
    } else if (callback) {
      callback.call(ads.adsClient, error);
    }
  });
};

var getSymbols = function (callback) {
  var ads = this;

  var cmdLength = {
    indexGroup: ADSIGRP.SYM_UPLOADINFO2,
    indexOffset: 0x00000000,
    byteLength: 0x30,
  };

  var cmdSymbols = {
    indexGroup: ADSIGRP.SYM_UPLOAD,
    indexOffset: 0x00000000,
  };

  readCommand.call(ads, cmdLength, function (error, result) {
    if (!error) {
      var data = result.readInt32LE(4);
      cmdSymbols.byteLength = data;

      readCommand.call(ads, cmdSymbols, function (error, result) {
        var symbols = [];
        var pos = 0;

        if (!error) {
          while (pos < result.length) {
            var symbol = {};
            var readLength = result.readUInt32LE(pos);
            symbol.indexGroup = result.readUInt32LE(pos + 4);
            symbol.indexOffset = result.readUInt32LE(pos + 8);
            // symbol.size = result.readUInt32LE(pos + 12);
            // symbol.type = result.readUInt32LE(pos + 16); //ADST_ ...
            // symbol.something = result.readUInt32LE(pos + 20);
            var nameLength = result.readUInt16LE(pos + 24) + 1;
            var typeLength = result.readUInt16LE(pos + 26) + 1;
            var commentLength = result.readUInt16LE(pos + 28) + 1;

            pos = pos + 30;

            var nameBuf = Buffer.alloc(nameLength);
            result.copy(nameBuf, 0, pos, pos + nameLength);
            symbol.name = nameBuf.toString('utf8', 0, helpers.findStringEnd(nameBuf, 0));
            pos = pos + nameLength;

            var typeBuf = Buffer.alloc(typeLength);
            result.copy(typeBuf, 0, pos, pos + typeLength);
            symbol.type = typeBuf.toString('utf8', 0, helpers.findStringEnd(typeBuf, 0));
            pos = pos + typeLength;

            var commentBuf = Buffer.alloc(commentLength);
            result.copy(commentBuf, 0, pos, pos + commentLength);
            symbol.comment = commentBuf.toString('utf8', 0, helpers.findStringEnd(commentBuf, 0));
            pos = pos + commentLength;

            if (symbol.type.indexOf('ARRAY') > -1) {
              var re = /ARRAY[\s]+\[([\-\d]+)\.\.([\-\d]+)\][\s]+of[\s]+(.*)/i;
              var m;

              if ((m = re.exec(symbol.type)) !== null) {
                if (m.index === re.lastIndex) {
                  re.lastIndex++;
                }

                m[1] = parseInt(m[1]);
                m[2] = parseInt(m[2]);

                for (var i = m[1]; i <= m[2]; i++) {
                  var newSymbol = JSON.parse(JSON.stringify(symbol));
                  newSymbol.arrayid = i + 0;
                  newSymbol.type = m[3] + '';
                  newSymbol.name += '[' + i + ']';
                  symbols.push(newSymbol);
                }
              }
            } else {
              symbols.push(symbol);
            }
          }
        }

        callback.call(ads.adsClient, error, symbols);
      });
    } else {
      callback.call(ads.adsClient, error);
    }
  });
};

var getHandles = function (handles, callback) {
  var ads = this;

  var data = handles.reduce(function (result, handle) {
    return result + handle.symName;
  }, '');

  var buf = Buffer.alloc(handles.length * 16 + data.length);

  handles.forEach(function (handle, index) {
    handle = helpers.parseHandle(handle);

    buf.writeUInt32LE(ADSIGRP.GET_SYMHANDLE_BYNAME, index * 16 + 0);
    buf.writeUInt32LE(0x00000000, index * 16 + 4);
    buf.writeUInt32LE(4, index * 16 + 8);
    buf.writeUInt32LE(handle.symName.length, index * 16 + 12);
  });

  buf.write(data, (handles.length) * 16 + 0);

  var request = {
    indexGroup: ADSIGRP.SUMUP_READWRITE,
    indexOffset: handles.length,
    writeBuffer: buf,
    readLength: handles.length * 12,
    symName: 'getHandles'
  };

  writeReadCommand.call(ads, request, function (error, result) {
    if (error) {
      callback.call(ads, error);
    } else {
      if (result.length > 0) {
        var resultpos = 0;
        var handlespos = handles.length * 8;

        handles.forEach(function (handle) {
          if (handle.symName !== undefined) {
            var adsError = result.readUInt32LE(resultpos);
            resultpos += 4;

            handle.error = helpers.getError(adsError);

            var symhandlebyte = result.readUInt32LE(resultpos);
            resultpos += 4;

            if (symhandlebyte == 4) {
              handle.symHandle = result.readUInt32LE(handlespos);
            }

            handlespos += symhandlebyte;

            var symHandleToRelease = Buffer.alloc(4);
            symHandleToRelease.writeUInt32LE(handle.symHandle, 0);
            ads.symHandlesToRelease.push(symHandleToRelease);
          }
        });
      }

      callback.call(ads, null, handles);
    }
  });
};

var getHandle = function (handle, callback) {
  var ads = this;

  handle = helpers.parseHandle(handle);

  if (typeof handle.symName === 'undefined') {
    handle.symName = handle.indexOffset;

    callback.call(ads, null, handle);
  } else {
    var buf = helpers.stringToBuffer(handle.symName);

    if (typeof handle.symHandle === 'undefined') {
      var commandOptions = {
        indexGroup: ADSIGRP.GET_SYMHANDLE_BYNAME,
        indexOffset: 0x00000000,
        writeBuffer: buf,
        readLength: 4,
        symName: handle.symName,
      };

      writeReadCommand.call(ads, commandOptions, function (error, result) {
        if (error) {
          callback.call(ads, error);
        } else {
          if (result.length > 0) {
            ads.symHandlesToRelease.push(result);
            handle.symHandle = result.readUInt32LE(0);

            callback.call(ads, null, handle);
          }
        }
      });
    } else {
      callback.call(ads, null, handle);
    }
  }
};

var releaseSymHandles = function (callback) {
  var ads = this;

  if (this.symHandlesToRelease.length > 0) {
    var symHandle = this.symHandlesToRelease.shift();

    releaseSymHandle.call(this, symHandle, function () {
      releaseSymHandles.call(ads, callback);
    });
  } else {
    callback.call(this);
  }
};

var releaseSymHandle = function (symHandle, callback) {
  var ads = this;

  var commandOptions = {
    indexGroup: ADSIGRP.RELEASE_SYMHANDLE,
    indexOffset: 0x00000000,
    byteLength: symHandle.length,
    bytes: symHandle
  };

  writeCommand.call(this, commandOptions, function (err) {
    callback.call(ads, err);
  });
};

var releaseNotificationHandles = function (callback) {
  var ads = this;

  if (this.notificationsToRelease.length > 0) {
    var notificationHandle = this.notificationsToRelease.shift();

    deleteDeviceNotificationCommand.call(this, notificationHandle, function () {
      releaseNotificationHandles.call(ads, callback);
    })
  } else {
    callback.call(this);
  }
};

//////////////////////// COMMANDS ///////////////////////

var readCommand = function (commandOptions, callback) {
  var buf = Buffer.alloc(12);

  buf.writeUInt32LE(commandOptions.indexGroup, 0);
  buf.writeUInt32LE(commandOptions.indexOffset, 4);
  buf.writeUInt32LE(commandOptions.byteLength, 8);

  var options = {
    commandId: ID.READ,
    data: buf,
    callback: callback,
    symName: commandOptions.symName,
  };

  runCommand.call(this, options);
};

var writeCommand = function (commandOptions, callback) {
  var buf = Buffer.alloc(12 + commandOptions.byteLength);

  buf.writeUInt32LE(commandOptions.indexGroup, 0);
  buf.writeUInt32LE(commandOptions.indexOffset, 4);
  buf.writeUInt32LE(commandOptions.byteLength, 8);

  commandOptions.bytes.copy(buf, 12);

  var options = {
    commandId: ID.WRITE,
    data: buf,
    callback: callback,
    symName: commandOptions.symName,
  };

  runCommand.call(this, options)
};

var addNotificationCommand = function (commandOptions, callback) {
  var buf = Buffer.alloc(40);

  buf.writeUInt32LE(commandOptions.indexGroup, 0);
  buf.writeUInt32LE(commandOptions.indexOffset, 4);
  buf.writeUInt32LE(commandOptions.byteLength, 8);
  buf.writeUInt32LE(commandOptions.transmissionMode, 12);
  buf.writeUInt32LE(commandOptions.maxDelay, 16);
  buf.writeUInt32LE(commandOptions.cycleTime * 10000, 20);
  buf.writeUInt32LE(0, 24);
  buf.writeUInt32LE(0, 28);
  buf.writeUInt32LE(0, 32);
  buf.writeUInt32LE(0, 36);

  var options = {
    commandId: ID.ADD_NOTIFICATION,
    data: buf,
    callback: callback,
    symName: commandOptions.symName,
  };

  runCommand.call(this, options);
};

var writeReadCommand = function (commandOptions, callback) {
  var buf = Buffer.alloc(16 + commandOptions.writeBuffer.length);

  buf.writeUInt32LE(commandOptions.indexGroup, 0);
  buf.writeUInt32LE(commandOptions.indexOffset, 4);
  buf.writeUInt32LE(commandOptions.readLength, 8);
  buf.writeUInt32LE(commandOptions.writeBuffer.length, 12);

  commandOptions.writeBuffer.copy(buf, 16);

  var options = {
    commandId: ID.READ_WRITE,
    data: buf,
    callback: callback,
    symName: commandOptions.symName,
  };

  runCommand.call(this, options);
};

var deleteDeviceNotificationCommand = function (notificationHandle, callback) {
  var buf = Buffer.alloc(4);

  buf.writeUInt32LE(notificationHandle, 0);

  var options = {
    commandId: ID.DEL_NOTIFICATION,
    data: buf,
    callback: callback,
  };

  runCommand.call(this, options);
};

var runCommand = function (options) {
  var tcpHeaderSize = 6;
  var headerSize = 32;
  var offset = 0;

  if (!options.callback) {
    throw new Error('A command needs a callback function!');
  }

  var header = Buffer.alloc(headerSize + tcpHeaderSize);

  // 2 bytes resserver (=0)
  header.writeUInt16LE(0, offset);
  offset += 2;

  // 4 bytes length
  header.writeUInt32LE(headerSize + options.data.length, offset);
  offset += 4;

  // 6 bytes: amsNetIdTarget
  var amsNetIdTarget = this.options.amsNetIdTarget.split('.');

  for (var i = 0; i < amsNetIdTarget.length; i++) {
    if (i >= 6) {
      throw new Error('Incorrect amsNetIdTarget length!');
    }

    amsNetIdTarget[i] = parseInt(amsNetIdTarget[i], 10);
    header.writeUInt8(amsNetIdTarget[i], offset);
    offset++;
  }

  // 2 bytes: amsPortTarget
  header.writeUInt16LE(this.options.amsPortTarget, offset);
  offset += 2;

  // 6 bytes amsNetIdSource
  var amsNetIdSource = this.options.amsNetIdSource.split('.');

  for (i = 0; i < amsNetIdSource.length; i++) {
    if (i >= 6) {
      throw new Error('Incorrect amsNetIdSource length!');
    }

    amsNetIdSource[i] = parseInt(amsNetIdSource[i], 10);
    header.writeUInt8(amsNetIdSource[i], offset);
    offset++;
  }

  // 2 bytes: amsPortTarget
  header.writeUInt16LE(this.options.amsPortSource, offset);
  offset += 2;

  // 2 bytes: Command ID
  header.writeUInt16LE(options.commandId, offset);
  offset += 2;

  // 2 bytes: state flags (ads request tcp)
  header.writeUInt16LE(4, offset);
  offset += 2;

  // 4 bytes: length of the data
  header.writeUInt32LE(options.data.length, offset);
  offset += 4;

  // 4 bytes: error code
  header.writeUInt32LE(0, offset);
  offset += 4;

  // 4 bytes: invoke id
  header.writeUInt32LE(++this.invokeId, offset);
  offset += 4;

  var buf = Buffer.alloc(tcpHeaderSize + headerSize + options.data.length);
  header.copy(buf, 0, 0);
  options.data.copy(buf, tcpHeaderSize + headerSize, 0);

  this.pending[this.invokeId] = {
    callback: options.callback,
    timeout: setTimeout(function () {
      delete this.pending[this.invokeId];

      options.callback('timeout');
    }.bind(this), 500),
  };

  helpers.logPackage.call(this, 'sending', buf, options.commandId, this.invokeId, options.symName);

  this.tcpClient.write(buf);
};

///////////////////// COMMAND RESULT PARSING ////////////////////////////

var getDeviceInfoResult = function (data, callback) {
  var adsError = data.readUInt32LE(0);
  // emitAdsError.call(this, adsError);
  var error = helpers.getError(adsError);
  var result;

  if (!error) {
    result = {
      majorVersion: data.readUInt8(4),
      minorVersion: data.readUInt8(5),
      versionBuild: data.readUInt16LE(6),
      deviceName: data.toString('utf8', 8, helpers.findStringEnd(data, 8)),
    };
  }

  callback.call(this.adsClient, error, result);
};

var getReadResult = function (data, callback) {
  var adsError = data.readUInt32LE(0);
  var result;
  // emitAdsError.call(this, adsError);
  var error = helpers.getError(adsError);

  if (!error) {
    var byteLength = data.readUInt32LE(4);

    result = Buffer.alloc(byteLength);
    data.copy(result, 0, 8, 8 + byteLength);
  }

  callback.call(this, error, result);
};

var getWriteReadResult = function (data, callback) {
  var adsError = data.readUInt32LE(0);
  var result;
  // emitAdsError.call(this, adsError);
  var error = helpers.getError(adsError);

  if (!error) {
    var byteLength = data.readUInt32LE(4);
    result = Buffer.alloc(byteLength);
    data.copy(result, 0, 8, 8 + byteLength);
  }

  callback.call(this, error, result);
};

var getWriteResult = function (data, callback) {
  var adsError = data.readUInt32LE(0);
  var error = helpers.getError(adsError);
  // emitAdsError.call(this, adsError)

  callback.call(this, error);
};

var getReadStateResult = function (data, callback) {
  var adsError = data.readUInt32LE(0);
  // emitAdsError.call(this, adsError);
  var error = helpers.getError(adsError);
  var result;

  if (!error) {
    result = {
      adsState: data.readUInt16LE(4),
      deviceState: data.readUInt16LE(6),
    };
  }

  callback.call(this.adsClient, error, result);
};

var getAddDeviceNotificationResult = function (data, callback) {
  var adsError = data.readUInt32LE(0);
  var notificationHandle;
  // emitAdsError.call(this, adsError);
  var error = helpers.getError(adsError);

  if (!error) {
    notificationHandle = data.readUInt32LE(4);
    this.notificationsToRelease.push(notificationHandle);
  }

  callback.call(this, error, notificationHandle);
};

var getDeleteDeviceNotificationResult = function (data, callback) {
  var adsError = data.readUInt32LE(0);
  // emitAdsError.call(this, adsError);
  var error = helpers.getError(adsError);

  callback.call(this, error);
};

var getNotificationResult = function (data) {
  var length = data.readUInt32LE(0);
  var stamps = data.readUInt32LE(4);
  var offset = 8;
  var timestamp = 0;
  var samples = 0;
  var notiHandle = 0;
  var size = 0;

  for (var i = 0; i < stamps; i++) {
    timestamp = data.readUInt32LE(offset); // TODO 8 bytes and convert
    offset += 8;
    samples = data.readUInt32LE(offset);
    offset += 4;
    for (var j = 0; j < samples; j++) {
      notiHandle = data.readUInt32LE(offset);
      offset += 4;
      size = data.readUInt32LE(offset);
      offset += 4;

      var buf = Buffer.alloc(size);
      data.copy(buf, 0, offset);
      offset += size;

      if (this.options.verbose > 0) {
        debug('Get notiHandle ' + notiHandle);
      }

      var handle = this.notifications[notiHandle];

      // It can happen that there is a notification before I
      // even have the notification handle.
      // In that case I just skip this notification.
      if (handle !== undefined) {
        helpers.integrateResultInHandle(handle, buf);
        this.adsClient.emit('notification', handle);
      } else {
        if (this.options.verbose > 0) {
          debug('skipping notification ' + notiHandle);
        }
      }
    }
  }
};

////////////////////////////// ADS TYPES /////////////////////////////////

var adsType = {
  length: 1,
  name: '',
};

exports.makeType = function (name) {
  var type = Object.create(adsType);

  type.length = typeLength[name];
  type.name = name;

  return type;
};

function exportType(name) {
  var type = exports.makeType(name);

  Object.defineProperty(exports, name, {
    value: type,
    writable: false,
  });
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
  'STRING': 81,
};

exportType('BOOL');
exportType('BYTE');
exportType('WORD');
exportType('DWORD');
exportType('SINT');
exportType('USINT');
exportType('INT');
exportType('UINT');
exportType('DINT');
exportType('UDINT');
exportType('LINT');
exportType('ULINT');
exportType('REAL');
exportType('LREAL');
// TIME,TIME_OF_DAY,TOD,DATE,DATE_AND_TIME,DT:
// Use handle.useLocalTimezone=false or true to switch it off or on
// default value if useLocalTimezone is not given is on
exportType('TIME');
exportType('TIME_OF_DAY');
exportType('TOD'); // TIME_OF_DAY alias
exportType('DATE');
exportType('DATE_AND_TIME');
exportType('DT'); // DATE_AND_TIME alias
exportType('STRING');

exports.string = function (length) {
  var type = {
    length: 81,
  };

  if (typeof length !== 'undefined') {
    type.length = arguments[0];
  }

  return type;
};