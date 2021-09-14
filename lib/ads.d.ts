import EventEmitter from "events";

/**
 * +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 * Types and Interfaces
 * +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 */
export interface AdsSymbolType {
  length: number;
  name: string;
}

export interface AdsClientConnectOptions {
  /**
   * The IP or hostname of the target machine
   */
  host: string;
  /**
   * The NetId of the target machine
   */
  amsNetIdTarget: string;
  /**
   * The NetId of the source machine.
   * You can choose anything in the form of x.x.x.x.x.x,
   * but on the target machine this must be added as a route.
   */
  amsNetIdSource: string;
  /**
   * The tcp destination port
   *
   * @default 48898
   */
  port?: number;
  /**
   * The ams source port
   *
   * @default 32905
   */
  amsPortSource?: number;
  /**
   * The ams target port for TwinCat Runtime 1
   * Default Ports 801 for TwinCat 2 and 851 for TwinCat 3
   *
   * @default 801
   */
  amsPortTarget?: number;
  /**
   * The timeout for PLC requests
   *
   * @default 500
   */
  timeout?: number;
  /**
   * The Local address the socket should connect from
   */
  localAddress?: string;
  /**
   * The Local port the socket should connect from
   */
  localPort?: number;
  /**
   * Version of IP stack. Must be 4, 6, or 0. The value 0 indicates that both IPv4 and IPv6 addresses are allowed.
   * Not set is both allowed (same as 0)
   */
  family?: 0 | 4 | 6;
  /**
   * Verbose Level 0, 1, 2
   *
   * @default 0
   */
  verbose?: 0 | 1 | 2;
}

export interface AdsClientHandle {
  /**
   * Handle name in twincat
   */
  symname?: string;
  indexGroup?: number;
  indexOffset?: number;
  /**
   * An ads type object or an array of type objects.
   * You can also specify a number or an array of numbers,
   * the result will then be a buffer object.
   *
   * @default BOOL
   */
  bytelength?: AdsSymbolType | AdsSymbolType[];
  /**
   * The propery name where the value should be written.
   * This can be an array with the same length as the array length of byteLength.
   *
   * @default 'value''
   */
  propname?: string | string[];
  /**
   * @default NOTIFY.ONCHANGE
   */
  transmissionMode?: number;
  /**
   * @default 0
   */
  maxDelay?: number;
  /**
   * @default 10
   */
  cycleTime?: number;
  lowIndex?: number;
  hiIndex?: number;
  useLocalTimezone?: boolean;
}

export interface AdsClientHandleAnswer extends AdsClientHandle {
  [propname: string]: any;
}

export interface AdsOptions {
  /**
   * The IP or hostname of the target machine
   */
  host: string;
  /**
   * The NetId of the target machine
   */
  amsNetIdTarget: string;
  /**
   * The NetId of the source machine.
   */
  amsNetIdSource: string;
  /**
   * The tcp destination port
   */
  port: number;
  /**
   * The ams source port
   */
  amsPortSource: number;
  /**
   * The ams target port for TwinCat Runtime
   */
  amsPortTarget: number;
  /**
   * The timeout for PLC requests
   */
  timeout: number;
  /**
   * The Local address the socket should connect from
   */
  localAddress?: string;
  /**
   * The Local port the socket should connect from
   */
  localPort?: number;
  /**
   * Version of IP stack. Must be 4, 6, or 0. The value 0 indicates that both IPv4 and IPv6 addresses are allowed.
   * Not set is both allowed (same as 0)
   */
  family?: 0 | 4 | 6;
  /**
   * Verbose Level 0, 1, 2
   */
  verbose: 0 | 1 | 2;
}

export interface AdsReadDeviceInfoResult {
  majorVersion: number;
  minorVersion: number;
  versionBuild: number;
  deviceName: string;
}

export interface AdsReadStateResult {
  adsState: number;
  deviceState: number;
}

export interface AdsSymbol {
  indexGroup: number;
  indexOffset: number;
  size: number;
  name: string;
  type: string;
  comment: string;
  arrayid?: number;
}

export interface Datatyp {
  index: number;
  version: number;
  size: number;
  dataType: number;
  arrayDim: number;
  subItems: number;
  name: string;
  type: string;
  comment: string;
}

export interface AdsDatatyp {
  version: number;
  size: number;
  dataType: number;
  arrayDim: number;
  subItems: number;
  name: string;
  type: string;
  comment: string;
  datatyps?: Datatyp[];
}

export interface AdsClient extends EventEmitter {
  options: AdsOptions;
  connect: (cb: (this: AdsClient) => void) => void;
  end: (cb?: (this: Ads) => void) => void;
  readDeviceInfo: (
    cb: (
      this: AdsClient,
      err: Error | null,
      result?: AdsReadDeviceInfoResult
    ) => void
  ) => void;
  read: (
    handle: AdsClientHandle,
    cb: (
      this: AdsClient,
      err: Error | null,
      handle: AdsClientHandleAnswer
    ) => void
  ) => void;
  write: (
    handle: AdsClientHandle,
    cb: (this: AdsClient, err: Error | null) => void
  ) => void;
  readState: (
    cb: (
      this: AdsClient,
      err: Error | null,
      result?: AdsReadStateResult
    ) => void
  ) => void;
  notify: (
    handle: AdsClientHandle,
    cb?: (this: AdsClient, err: Error | null) => void
  ) => void;
  releaseNotificationHandles: (cb: (this: Ads) => void) => void;
  releaseNotificationHandle: (
    handle: AdsClientHandle,
    cb: (this: Ads) => void
  ) => void;
  writeRead: (
    handle: AdsClientHandle,
    cb: (this: Ads, err: Error | null, result: any) => void
  ) => void;
  getSymbols: (
    cb: (this: AdsClient, err: Error | null, symbols?: AdsSymbol[]) => void,
    raw: unknown
  ) => void;
  getDatatyps: (
    cb: (this: AdsClient, err: Error | null, datatyps?: AdsDatatyp[]) => void
  ) => void;
  multiRead: (
    handles: AdsClientHandle[],
    cb: (
      this: AdsClient,
      err: Error | null,
      handles?: AdsClientHandleAnswer[]
    ) => void
  ) => void;
  multiWrite: (
    handles: AdsClientHandle[],
    cb: (
      this: AdsClient,
      err: Error | null,
      handles?: AdsClientHandle[]
    ) => void
  ) => void;
  getHandles: (
    handles: AdsClientHandle[],
    cb: (
      this: AdsClient,
      error: Error | null,
      handles?: AdsClientHandle
    ) => void
  ) => void;
}

export interface Ads {
  connected: boolean;
  options: AdsOptions;
  invokeId: number;
  pending: Record<
    number,
    {
      cb: (this: Ads | AdsClient, error: Error | null, response?: any) => void;
      timeout: NodeJS.Timeout;
    }
  >;
  symHandlesToRelease: Buffer[];
  notificationsToRelease: Buffer[];
  notifications: Record<number, AdsClientHandle>;
  dataStream: Buffer | null;
  tcpHeaderSize: number;
  amsHeaderSize: number;
  adsClient: AdsClient;
}

/**
 * +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 * CONST
 * +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 */
export const ERRORS: {
  0: "OK";
  1: "Internal error";
  2: "No Rtime";
  3: "Allocation locked memory error";
  4: "Insert mailbox error";
  5: "Wrong receive HMSG";
  6: "target port not found";
  7: "target machine not found";
  8: "Unknown command ID";
  9: "Bad task ID";
  10: "No IO";
  11: "Unknown AMS command";
  12: "Win 32 error";
  13: "Port not connected";
  14: "Invalid AMS length";
  15: "Invalid AMS Net ID";
  16: "Low Installation level";
  17: "No debug available";
  18: "Port disabled";
  19: "Port already connected";
  20: "AMS Sync Win32 error";
  21: "AMS Sync Timeout";
  22: "AMS Sync AMS error";
  23: "AMS Sync no index map";
  24: "Invalid AMS port";
  25: "No memory";
  26: "TCP send error";
  27: "Host unreachable";
  1792: "error class <device error>";
  1793: "Service is not supported by server";
  1794: "invalid index group";
  1795: "invalid index offset";
  1796: "reading/writing not permitted";
  1797: "parameter size not correct";
  1798: "invalid parameter value(s)";
  1799: "device is not in a ready state";
  1800: "device is busy";
  1801: "invalid context (must be in Windows)";
  1802: "out of memory";
  1803: "invalid parameter value(s)";
  1804: "not found (files, ...)";
  1805: "syntax error in command or file";
  1806: "objects do not match";
  1807: "object already exists";
  1808: "symbol not found";
  1809: "symbol version invalid";
  1810: "server is in invalid state";
  1811: "AdsTransMode not supported";
  1812: "Notification handle is invalid";
  1813: "Notification client not registered";
  1814: "no more notification handles";
  1815: "size for watch too big";
  1816: "device not initialized";
  1817: "device has a timeout";
  1818: "query interface failed";
  1819: "wrong interface required";
  1820: "class ID is invalid";
  1821: "object ID is invalid";
  1822: "request is pending";
  1823: "request is aborted";
  1824: "signal warning";
  1825: "invalid array index";
  1826: "symbol not active -> release handle and try again";
  1827: "access denied";
  1856: "Error class <client error>";
  1857: "invalid parameter at service";
  1858: "polling list is empty";
  1859: "var connection already in use";
  1860: "invoke ID in use";
  1861: "timeout elapsed";
  1862: "error in win32 subsystem";
  1863: "Invalid client timeout value";
  1864: "ads-port not opened";
  1872: "internal error in ads sync";
  1873: "hash table overflow";
  1874: "key not found in hash";
  1875: "no more symbols in cache";
  1876: "invalid response received";
  1877: "sync port is locked";
};

export const NOTIFY: {
  CYCLIC: 3;
  ONCHANGE: 4;
};

declare function fromId(id: number): string;

export const ADSSTATE: {
  INVALID: 0;
  IDLE: 1;
  RESET: 2;
  INIT: 3;
  START: 4;
  RUN: 5;
  STOP: 6;
  SAVECFG: 7;
  LOADCFG: 8;
  POWERFAILURE: 9;
  POWERGOOD: 10;
  ERROR: 11;
  SHUTDOWN: 12;
  SUSPEND: 13;
  RESUME: 14;
  CONFIG: 15;
  RECONFIG: 16;
  STOPPING: 17;
  fromId;
};

export const ADSIGRP: {
  SYMTAB: 0xf000;
  SYMNAME: 0xf001;
  SYMVAL: 0xf002;
  GET_SYMHANDLE_BYNAME: 0xf003; // {TcAdsDef.h: ADSIGRP_SYM_HNDBYNAME}
  READ_SYMVAL_BYNAME: 0xf004; // {TcAdsDef.h: ADSIGRP_SYM_VALBYNAME}
  RW_SYMVAL_BYHANDLE: 0xf005; // {TcAdsDef.h: ADSIGRP_SYM_VALBYHND}
  RELEASE_SYMHANDLE: 0xf006; // {TcAdsDef.h: ADSIGRP_SYM_RELEASEHND}
  SYM_INFOBYNAME: 0xf007;
  SYM_VERSION: 0xf008;
  SYM_INFOBYNAMEEX: 0xf009;
  SYM_DOWNLOAD: 0xf00a;
  SYM_UPLOAD: 0xf00b;
  SYM_UPLOADINFO: 0xf00c;
  SYM_DOWNLOAD2: 0xf00d;
  SYM_DT_UPLOAD: 0xf00e;
  SYM_UPLOADINFO2: 0xf00f;
  SYMNOTE: 0xf010; // notification of named handle
  SUMUP_READ: 0xf080; // AdsRW  IOffs list size or 0 (=0 -> list size == WLength/3*sizeof(ULONG))
  // W: {list of IGrp, IOffs, Length}
  // if IOffs != 0 then R: {list of results} and {list of data}
  // if IOffs == 0 then R: only data (sum result)
  SUMUP_WRITE: 0xf081; // AdsRW  IOffs list size
  // W: {list of IGrp, IOffs, Length} followed by {list of data}
  // R: list of results
  SUMUP_READWRITE: 0xf082; // AdsRW  IOffs list size
  // W: {list of IGrp, IOffs, RLength, WLength} followed by {list of data}
  // R: {list of results, RLength} followed by {list of data}
  SUMUP_READEX: 0xf083; // AdsRW  IOffs list size
  // W: {list of IGrp, IOffs, Length}
  SUMUP_READEX2: 0xf084; // AdsRW  IOffs list size
  // W: {list of IGrp, IOffs, Length}
  // R: {list of results, Length} followed by {list of data (returned lengths)}
  SUMUP_ADDDEVNOTE: 0xf085; // AdsRW  IOffs list size
  // W: {list of IGrp, IOffs, Attrib}
  // R: {list of results, handles}
  SUMUP_DELDEVNOTE: 0xf086; // AdsRW  IOffs list size
  // W: {list of handles}
  // R: {list of results, Length} followed by {list of data}
  IOIMAGE_RWIB: 0xf020; // read/write input byte(s)
  IOIMAGE_RWIX: 0xf021; // read/write input bit
  IOIMAGE_RISIZE: 0xf025; // read input size (in byte)
  IOIMAGE_RWOB: 0xf030; // read/write output byte(s)
  IOIMAGE_RWOX: 0xf031; // read/write output bit
  IOIMAGE_CLEARI: 0xf040; // write inputs to null
  IOIMAGE_CLEARO: 0xf050; // write outputs to null
  IOIMAGE_RWIOB: 0xf060; // read input and write output byte(s)
  DEVICE_DATA: 0xf100; // state, name, etc...
};

export const ADSIOFFS_DEVDATA: {
  ADSSTATE: 0x0000; // ads state of device
  DEVSTATE: 0x0002; // device state
};

export const BOOL: AdsSymbolType;
export const BYTE: AdsSymbolType;
export const WORD: AdsSymbolType;
export const DWORD: AdsSymbolType;
export const SINT: AdsSymbolType;
export const USINT: AdsSymbolType;
export const INT: AdsSymbolType;
export const UINT: AdsSymbolType;
export const DINT: AdsSymbolType;
export const UDINT: AdsSymbolType;
export const LINT: AdsSymbolType;
export const ULINT: AdsSymbolType;
export const REAL: AdsSymbolType;
export const LREAL: AdsSymbolType;
export const TIME: AdsSymbolType;
export const TIME_OF_DAY: AdsSymbolType;
export const TOD: AdsSymbolType;
export const DATE: AdsSymbolType;
export const DATE_AND_TIME: AdsSymbolType;
export const DT: AdsSymbolType;
export const STRING: AdsSymbolType;

/**
 * +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 * Functions
 * +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 */
export function connect(
  options: AdsClientConnectOptions,
  cb: (this: AdsClient) => void
): AdsClient;
export function string(length?: number): AdsSymbolType;
export function array(
  typ: AdsSymbolType,
  lowIndex: number,
  hiIndex: number
): AdsSymbolType;
export function useLocalTimezone(
  type: AdsSymbolType,
  use?: boolean
): AdsSymbolType;
