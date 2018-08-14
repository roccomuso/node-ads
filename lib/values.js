const ID = {
    READ_DEVICE_INFO: 1,
    READ: 2,
    WRITE: 3,
    READ_STATE: 4,
    WRITE_CONTROL: 5,
    ADD_NOTIFICATION: 6,
    DEL_NOTIFICATION: 7,
    NOTIFICATION: 8,
    READ_WRITE: 9,
}
exports.ID = ID;

const ERRORS = {
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
};
exports.ERRORS = ERRORS;

const NOTIFY = {
    CYCLIC: 3,
    ONCHANGE: 4
};
exports.NOTIFY = NOTIFY;


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
    fromId: function (id) {
        var adsStates = this;
        var adsState;

        Object.keys(adsStates).map(function (key) {
            if (adsStates[key] === id) {
                adsState = key;
            };
        });

        return adsState;
    }
}
exports.ADSSTATE = ADSSTATE;

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
    SYMNOTE: 0xF010, // notification of named handle
    SUMUP_READ: 0xF080, // AdsRW  IOffs list size or 0 (=0 -> list size == WLength/3*sizeof(ULONG))
    // W: {list of IGrp, IOffs, Length}
    // if IOffs != 0 then R: {list of results} and {list of data}
    // if IOffs == 0 then R: only data (sum result)
    SUMUP_WRITE: 0xF081, // AdsRW  IOffs list size
    // W: {list of IGrp, IOffs, Length} followed by {list of data}
    // R: list of results
    SUMUP_READWRITE: 0xF082, // AdsRW  IOffs list size
    // W: {list of IGrp, IOffs, RLength, WLength} followed by {list of data}
    // R: {list of results, RLength} followed by {list of data}
    SUMUP_READEX: 0xF083, // AdsRW  IOffs list size
    // W: {list of IGrp, IOffs, Length}
    SUMUP_READEX2: 0xF084, // AdsRW  IOffs list size
    // W: {list of IGrp, IOffs, Length}
    // R: {list of results, Length} followed by {list of data (returned lengths)}
    SUMUP_ADDDEVNOTE: 0xF085, // AdsRW  IOffs list size
    // W: {list of IGrp, IOffs, Attrib}
    // R: {list of results, handles}
    SUMUP_DELDEVNOTE: 0xF086, // AdsRW  IOffs list size
    // W: {list of handles}
    // R: {list of results, Length} followed by {list of data}
    IOIMAGE_RWIB: 0xF020, // read/write input byte(s)
    IOIMAGE_RWIX: 0xF021, // read/write input bit
    IOIMAGE_RISIZE: 0xF025, // read input size (in byte)
    IOIMAGE_RWOB: 0xF030, // read/write output byte(s)
    IOIMAGE_RWOX: 0xF031, // read/write output bit
    IOIMAGE_CLEARI: 0xF040, // write inputs to null
    IOIMAGE_CLEARO: 0xF050, // write outputs to null
    IOIMAGE_RWIOB: 0xF060, // read input and write output byte(s)
    DEVICE_DATA: 0xF100, // state, name, etc...
};
exports.ADSIGRP = ADSIGRP;

exports.ADSIOFFS_DEVDATA = {
    ADSSTATE: 0x0000, // ads state of device
    DEVSTATE: 0x0002, // device state
};