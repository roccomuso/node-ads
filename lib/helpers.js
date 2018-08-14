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

const {
    ID,
    ERRORS,
    NOTIFY,
    ADSSTATE,
    ADSIGRP,
    ADSIOFFS_DEVDATA
} = require('./values');

const helpers = {
    stringToBuffer: function (someString) {
        var buf = Buffer.alloc(someString.length + 1);

        buf.write(someString);
        buf[someString.length] = 0;

        return buf;
    },

    parseOptions: function (options) {
        // Defaults
        if (typeof options.port === 'undefined') {
            options.port = 48898;
        }

        if (typeof options.amsPortSource === 'undefined') {
            options.amsPortSource = 32905;
        }

        if (typeof options.amsPortTarget === 'undefined') {
            options.amsPortTarget = 801;
        }

        if (typeof options.host === 'undefined') {
            throw new Error('host not defined!');
        }

        if (typeof options.amsNetIdTarget === 'undefined') {
            throw new Error('amsNetIdTarget not defined!');
        }

        if (typeof options.amsNetIdSource === 'undefined') {
            throw new Error('amsNetIdTarget not defined!');
        }

        if (options.verbose === undefined) {
            options.verbose = 0;
        }

        return options;
    },

    getCommandDescription: function (commandId) {
        var desc = 'Unknown command';

        switch (commandId) {
            case ID.READ_DEVICE_INFO:
                desc = 'Read device info';
                break;
            case ID.READ:
                desc = 'Read';
                break;
            case ID.WRITE:
                desc = 'Write';
                break;
            case ID.READ_STATE:
                desc = 'Read state';
                break;
            case ID.WRITE_CONTROL:
                desc = 'Write control';
                break;
            case ID.ADD_NOTIFICATION:
                desc = 'Add notification';
                break;
            case ID.DEL_NOTIFICATION:
                desc = 'Delete notification';
                break;
            case ID.NOTIFICATION:
                desc = 'Notification';
                break;
            case ID.READ_WRITE:
                desc = 'ReadWrite';
                break;
        }

        return desc;
    },

    getValue: function (dataName, result, offset, useLocalTimezone) {
        var value;
        var timeoffset;

        switch (dataName) {
            case 'BOOL':
            case 'BYTE':
            case 'USINT':
                value = result.readUInt8(offset);
                break;
            case 'SINT':
                value = result.readInt8(offset);
                break;
            case 'UINT':
            case 'WORD':
                value = result.readUInt16LE(offset);
                break;
            case 'INT':
                value = result.readInt16LE(offset);
                break;
            case 'DWORD':
            case 'UDINT':
                value = result.readUInt32LE(offset);
                break;
            case 'DINT':
                value = result.readInt32LE(offset);
                break;
            case 'REAL':
                value = result.readFloatLE(offset);
                break;
            case 'LREAL':
                value = result.readDoubleLE(offset);
                break;
            case 'STRING':
                value = result.toString('utf8', offset, helpers.findStringEnd(result, offset));
                break;
            case 'TIME':
            case 'TIME_OF_DAY':
            case 'TOD':
                var milliseconds = result.readUInt32LE(offset);
                value = new Date(milliseconds);

                if (useLocalTimezone) {
                    timeoffset = value.getTimezoneOffset();
                    value = new Date(value.setMinutes(value.getMinutes() + timeoffset));
                }
                break;
            case 'DATE':
            case 'DATE_AND_TIME':
            case 'DT':
                var seconds = result.readUInt32LE(offset);
                value = new Date(seconds * 1000);

                if (useLocalTimezone) {
                    timeoffset = value.getTimezoneOffset();
                    value = new Date(value.setMinutes(value.getMinutes() + timeoffset));
                }
                break;
        }

        return value;
    },

    integrateResultInHandle: function (handle, result) {
        var offset = 0;
        var l = 0;
        var convert = {
            isAdsType: false,
        };

        for (var i = 0; i < handle.propname.length; i++) {
            l = helpers.getItemByteLength(handle.byteLength[i], convert);

            var value = result.slice(offset, offset + l);

            if (convert.isAdsType) {
                value = helpers.getValue(handle.byteLength[i].name, result, offset, (handle.useLocalTimezone !== 'undefined' ? handle.useLocalTimezone : true));
            }

            handle[handle.propname[i]] = value;

            offset += l;
        }
    },

    parseHandle: function (handle) {
        if (typeof handle.symName === 'undefined' &&
            (typeof handle.indexGroup === 'undefined' || typeof handle.indexOffset === 'undefined')) {
            throw new Error("The handle doesn't have a symName or an indexGroup and indexOffset property!");
        }

        if (typeof handle.propname !== 'undefined') {
            if (!Array.isArray(handle.propname)) {
                handle.propname = [handle.propname];
            }
        } else {
            handle.propname = ['value'];
        }

        if (typeof handle.byteLength === 'undefined') {
            handle.byteLength = [exports.BOOL];
        }

        if (!Array.isArray(handle.byteLength)) {
            handle.byteLength = [handle.byteLength];
        }

        handle.totalByteLength = 0
        for (var i = 0; i < handle.byteLength.length; i++) {
            if (typeof handle.byteLength[i] === 'number') {
                handle.totalByteLength += handle.byteLength[i];
            }
            if (typeof handle.byteLength[i] === 'object') {
                handle.totalByteLength += handle.byteLength[i].length;
            }
        }

        if (handle.byteLength.length !== handle.propname.length) {
            throw new Error('The array byteLength and propname should have the same length!');
        }

        if (typeof handle.transmissionMode === 'undefined') {
            handle.transmissionMode = NOTIFY.ONCHANGE;
        }

        if (typeof handle.maxDelay === 'undefined') {
            handle.maxDelay = 0;
        }

        if (typeof handle.cycleTime === 'undefined') {
            handle.cycleTime = 10;
        }

        return handle;
    },

    getBytesFromHandle: function (handle) {
        var p = '';
        var buf = Buffer.alloc(handle.totalByteLength);
        var offset = 0;
        var convert = {
            isAdsType: false
        };
        // var l = 0

        for (var i = 0; i < handle.propname.length; i++) {
            p = handle.propname[i]
            helpers.getItemByteLength(handle.byteLength[i], convert);

            if (!convert.isAdsType) {
                handle[p].copy(buf, offset);
            }

            if ((typeof handle[p] !== 'undefined') && convert.isAdsType) {
                var datetime;
                var timeoffset;

                switch (handle.byteLength[i].name) {
                    case 'BOOL':
                    case 'BYTE':
                    case 'USINT':
                        buf.writeUInt8(handle[p], offset);
                        break;
                    case 'SINT':
                        buf.writeInt8(handle[p], offset);
                        break;
                    case 'UINT':
                    case 'WORD':
                        buf.writeUInt16LE(handle[p], offset);
                        break;
                    case 'INT':
                        buf.writeInt16LE(handle[p], offset);
                        break;
                    case 'DWORD':
                    case 'UDINT':
                        buf.writeUInt32LE(handle[p], offset);
                        break;
                    case 'DINT':
                        buf.writeInt32LE(handle[p], offset);
                        break;
                    case 'REAL':
                        buf.writeFloatLE(handle[p], offset);
                        break;
                    case 'LREAL':
                        buf.writeDoubleLE(handle[p], offset);
                        break;
                    case 'STRING':
                        var stringbuf = Buffer.alloc(handle[p].toString() + '\0', 'utf8');
                        stringbuf.copy(buf, offset);
                        break;
                    case 'TIME':
                    case 'TIME_OF_DAY':
                    case 'TOD':
                        datetime = new Date(handle[p]);

                        if (handle.useLocalTimezone) {
                            timeoffset = datetime.getTimezoneOffset();
                            datetime = new Date(datetime.setMinutes(datetime.getMinutes() - timeoffset));
                        }

                        buf.writeUInt32LE(datetime.getTime());
                    case 'DATE':
                    case 'DATE_AND_TIME':
                    case 'DT':
                        datetime = new Date(handle[p]);

                        if (handle.useLocalTimezone) {
                            timeoffset = datetime.getTimezoneOffset();
                            datetime = new Date(datetime.setMinutes(datetime.getMinutes() - timeoffset));
                        }

                        buf.writeUInt32LE((datetime.getTime() / 1000));
                        break;
                }
            } else if (typeof handle[p] === 'undefined') {
                throw new Error('Property ' + p + ' not available on handle!');
            }
        }

        handle.bytes = buf;
    },

    getItemByteLength: function (byteLength, convert) {
        var length = 0;

        if (typeof byteLength === 'number') {
            length = byteLength;
        } else {
            length = byteLength.length;
            convert.isAdsType = true;
        }

        return length;
    },

    findStringEnd: function (data, offset) {
        if (!offset) {
            offset = 0;
        }
        var endpos = offset;

        for (var i = offset; i < data.length; i++) {
            if (data[i] === 0x00) {
                endpos = i;
                break;
            }
        }

        return endpos;
    },

    logPackage: function (info, buf, commandId, invokeId, symName) {
        while (info.length < 10) info = info + ' ';

        var msg = info + ' -> commandId: ' + commandId;
        msg += ' (' + helpers.getCommandDescription(commandId) + ') ';
        msg += ', invokeId: ' + invokeId;

        if (symName !== undefined) {
            msg += ' symName: ' + symName;
        }

        if (this.options.verbose > 0) {
            debug(msg);
        }

        if (this.options.verbose > 1) {
            debug(buf.inspect());
            // debug(buf)
        }
    },

    emitAdsError: function (errorId) {
        var error = helpers.getError(errorId);

        if (error) {
            this.adsClient.emit('error', error);
        }
    },

    getError: function (errorId) {
        if (errorId === 0) {
            return;
        }

        return new Error(ERRORS[errorId]);
    },
};
module.exports = helpers;