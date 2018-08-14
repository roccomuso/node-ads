node-ads [![NPM Version](https://img.shields.io/npm/v/node-ads.svg)](https://www.npmjs.com/package/node-ads) ![node](https://img.shields.io/node/v/node-ads.svg) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
======

> A NodeJS implementation for the Twincat ADS protocol.
> (Twincat and ADS is from Beckhoff &copy;. I'm not affiliated.)

### Changelog

initial version

### Connect with PLC

```javascript
var ads = require('node-ads');

var options = {
    //The IP or hostname of the target machine
    host: "10.0.0.2",
    //The NetId of the target machine
    amsNetIdTarget: "5.1.204.160.1.1",
    //The NetId of the source machine.
    //You can choose anything in the form of x.x.x.x.x.x,
    //but on the target machine this must be added as a route.
    amsNetIdSource: "192.168.137.50.1.1",

    //OPTIONAL: (These are set by default)
    //The tcp destination port
    //port: 48898
    //The ams source port
    //amsPortSource: 32905
    //The ams target port
    //amsPortTarget: 801
}

var client = ads.connect(options, function() {
    this.readDeviceInfo(function(error, result) {
        if (error) {
            console.log(error);
        }

        console.log(result);
        this.end();
    });
});

client.on('error', function(error) {
    console.log(error);
});
```


### How to define Handles

```javascript
var handle = {
    /*
        the symname is the name of the Symbol which is defined in the PLC
    */
    symName: '.TESTINT',

    /*
        An ads type object or an array of type objects.
        You can also specify a number or an array of numbers,
        the result will then be a buffer object.
        If not defined, the default will be BOOL.
    */
    byteLength: ads.INT,

    /*
        The propery name where the value should be written.
        This can be an array with the same length as the array length of byteLength.
        If not defined, the default will be 'value'.
    */
    propname: 'value',

    /*
        The value is only necessary to write data.
    */
    value: 5,

    /*
        OPTIONAL: (These are set by default)  
    */ 
    transmissionMode: ads.NOTIFY.ONCHANGE // or ads.NOTIFY.CYLCIC
    
    /*
        Latest time (in ms) after which the event has finished
    */
    maxDelay: 0,

    /*
        Time (in ms) after which the PLC server checks whether the variable has changed
    */
    cycleTime: 10,
}
```

### Read single symbol

```javascript
var handle = {
    symName: '.TESTINT',
    byteLength: ads.INT,
    propName: 'value',
};

var client = ads.connect(options, function() {
    this.read(handle, function(error, handle) {
        if (error) {
            console.log(error);
        };

        console.log(handle.value);

        this.end();
    })
});
```


### Write single symbol data

```javascript
var handle = {
    symName: '.TESTINT',
    byteLength: ads.INT,
    value: 5
};

var client = ads.connect(options, function() {
    this.write(handle, function(error) {
        if (error) {
            console.log(error);
        }

        this.read(handle, function(error, handle) {
            if (error) {
                 console.error(error);
            }

            console.log(handle.value);

            this.end();
        });
    });
});
```


### Read multiple symbols data

```javascript
var client = ads.connect(options, function() {
    this.multiRead(
        [{
            symName: '.TESTBOOL',
            byteLength: ads.BOOL,
        }, {
            symName: '.TESTINT',
            byteLength: ads.UINT,
        }],
        function (handles) {
            if (handles.error) {
                console.error(handles.error);
            }

            console.log(handles);

            this.end();
        }
    );
});
```


### Get handles

```javascript
var client = ads.connect(options, function() {
    this.getHandles(
        [{
            symName: '.TESTBOOL',
        }, {
            symName: '.TESTINT',
        }],
        function (error, handles) {
            if (error) {
                console.error(error);
            } else if (handles.error) {
                console.error(handles.error);
            } else {
                console.log(handles);
            }

            this.end();
        }
    );
})
```


### Get notifications

```javascript
var handle = {
    symName: '.CounterTest',       
    byteLength: ads.WORD,  
};

var client = ads.connect(options, function() {
    this.notify(handle);
});

client.on('notification', function(handle){
    console.log(handle.value);
});

process.on('exit', function () {
    console.log('exit');
});

process.on('SIGINT', function() {
    client.end(function() {
        process.exit();
    });
});
```


### Get symbol list

```javascript
var client = ads.connect(options, function() {
    this.getSymbols(function(error, symbols) {
        if (error) {
            console.error(error);
        }
        console.log(symbols);

        this.end();
    });
});
```


### Read device state

```javascript
var client = ads.connect(options, function() {
    this.readState(function(error, result) {
        if (error) {
            console.error(error);
        }

        var text = '?';

        switch (result.adsState) {
            case ads.ADSSTATE.INVALID:
                text = 'INVALID';
                break;
            case ads.ADSSTATE.IDLE:
                text = 'IDLE';
                break;
            case ads.ADSSTATE.RESET:
                text = 'RESET';
                break;
            case ads.ADSSTATE.INIT:
                text = 'INIT';
                break;
            case ads.ADSSTATE.START:
                text = 'START';
                break;
            case ads.ADSSTATE.RUN:
                text = 'RUN';
                break;
            case ads.ADSSTATE.STOP:
                text = 'STOP';
                break;
            case ads.ADSSTATE.SAVECFG:
                text = 'SAVECFG';
                break;
            case ads.ADSSTATE.LOADCFG:
                text = 'LOADCFG';
                break;
            case ads.ADSSTATE.POWERFAILURE:
                text = 'POWERFAILURE';
                break;
            case ads.ADSSTATE.POWERGOOD:
                text = 'POWERGOOD';
                break;
            case ads.ADSSTATE.ERROR:
                text = 'ERROR';
                break;
            case ads.ADSSTATE.SHUTDOWN:
                text = 'SHUTDOWN';
                break;
            case ads.ADSSTATE.SUSPEND:
                text = 'SUSPEND';
                break;
            case ads.ADSSTATE.RESUME:
                text = 'RESUME';
                break;
            case ads.ADSSTATE.CONFIG:
                text = 'CONFIG';
                break;
            case ads.ADSSTATE.RECONFIG:
                text = 'RECONFIG';
                break;
            case ads.ADSSTATE.STOPPING:
                text = 'STOPPING';
                break;
        }
        console.log('The state is ' + text);

        this.end();
    });
});
```

### Event-Driven Detection of Changes to the Symbol Table

If the symbol table changes for example, a new PLC program is written into the controller, the handles must be loaded once again.
  
The example below illustrates how changes to the symbol table can be detected.

```javascript
var start = true;

var client = ads.connect(options, function() {
    start = true;
    this.notify(handle);
});

var handle = {
    indexGroup: ads.ADSIGRP.SYM_VERSION,
    indexOffset: 0,
    byteLength: ads.BYTE,
};

client.on('notification', function(handle) {
    if (start) {
      console.log('symbol table version ' + handle.value);
    } else {
      console.log('symbol table changed ' + handle.value);
    }
    
    start = false;
});

process.on('SIGINT', function() {
    client.end(function() {
        process.exit();
    });
});

client.on('error', function(error) {
    console.log(error);
});
```

License (MIT)
-------------
Copyright (c) 2018 src-one
Copyright (c) 2012 Inando

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.