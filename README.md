node-ads [![NPM Version](https://img.shields.io/npm/v/node-ads.svg)](https://www.npmjs.com/package/node-ads) ![node](https://img.shields.io/node/v/node-ads.svg) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
======


> A NodeJS implementation for the Twincat ADS protocol.
> (Twincat and ADS is from Beckhoff &copy;. I'm not affiliated.)

### Changelog

- `debug` module.
- Added aliases: `TOD -> TIME_OF_DAY` and `DT -> DATE_AND_TIME`.
- Code standardized.
- Using `safe-buffer`.
- When we use notification, the notification will blocked to fire if too many notifications are defined
- `multiRead` method and read bug fix (timeout).
- `multiRead` and `getHandels` method improved, `multiWrite` added.
- working string length
- array added

Examples
--------

### Hello machine


```javascript
var ads = require('node-ads')

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
    this.readDeviceInfo(function(err, result) {
        if (err) console.log(err)
        console.log(result)
        this.end()
    })
})

client.on('error', function(error) {
    console.log(error)
})
```

### Read something

```javascript
var myHandle = {
    //Handle name in twincat
    symname: '.TESTINT',  
    //An ads type object or an array of type objects.
    //You can also specify a number or an array of numbers,
    //the result will then be a buffer object.
    //If not defined, the default will be BOOL.
    bytelength: ads.INT,  
    //The propery name where the value should be written.
    //This can be an array with the same length as the array length of byteLength.
    //If not defined, the default will be 'value'.     
    propname: 'value'      
}

var client = ads.connect(options, function() {
    this.read(myHandle, function(err, handle) {
        if (err) console.log(err)
        //result is the myHandle object with the new properties filled in
        console.log(handle.value)
        //All handles will be released automaticly here
        this.end()
    })
})
```

### Write something

```javascript
var client = ads.connect(options, function() {
    myHandle.value = 5
    this.write(myHandle, function(err) {
        if (err) console.log(err)
        this.read(myHandle, function(err, handle) {
            if (err) console.log(err)
            console.log(handle.value)
            this.end()
        })
    })
})
```

### Get notifications

```javascript
var myHandle = {
    symname: '.CounterTest',       
    bytelength: ads.WORD,  

    //OPTIONAL: (These are set by default)       
    //transmissionMode: ads.NOTIFY.ONCHANGE, (other option is ads.NOTIFY.CYCLIC)
    //maxDelay: 0,  -> Latest time (in ms) after which the event has finished
    //cycleTime: 10 -> Time (in ms) after which the PLC server checks whether the variable has changed
}

var client = ads.connect(options, function() {
    this.notify(myHandle)
})

client.on('notification', function(handle){
    console.log(handle.value)
})

process.on('exit', function () {
    console.log("exit")
})

process.on('SIGINT', function() {
    client.end(function() {
        process.exit()
    })
})
```

### MultiRead something

```javascript
var client = ads.connect(options, function() {
    this.multiRead(
        [{
            symname: '.TESTBOOL',
            bytelength: ads.BOOL,
        }, {
            symname: '.TESTINT',
            bytelength: ads.UINT,
        }],
        function (error, handles) {
            if (error) {
                console.log(error)
            } else {
                handles.forEach(function(handle){
                    if (handle.err) {
                        console.error(handle.err)
                    } else {
                        console.log(handle.value)
                    }
                }
            }
            this.end()
        })
    )
})
```

### MultiWrite something

```javascript
var client = ads.connect(options, function() {
    this.multiRead(
        [{
            symname: '.TESTBOOL',
            bytelength: ads.BOOL,
            value: false
       }, {
            symname: '.TESTINT',
            bytelength: ads.UINT,
            value: 5
        }],
        function (error, handles) {
            if (error) {
                console.log(error)
            } else {
                handles.forEach(function(handle){
                    if (handle.err) {
                        console.error(handle.err)
                    } else {
                        console.log(handle.value)
                    }
                }
            }
            this.end()
        })
    )
})
```

### Get handles

```javascript
var client = ads.connect(options, function() {
    this.getHandles(
        [{
            symname: '.TESTBOOL',
        }, {
            symname: '.TESTINT',
        }],
        function (error, handles) {
            if (error) {
                console.log(error)
            } else if (handles.err) {
                console.error(handles.err)
            } else {
                console.log(handles)
            }
            this.end()
        })
})
```

### Get symbol list

```javascript
client = ads.connect(options, function() {
    this.getSymbols(function(err, symbols) {
        if (err) console.log(err)
        console.log(symbols)
        this.end()
    })
})
```

### Read device state

```javascript
var client = ads.connect(options, function() {
    this.readState(function(error,result) {
      if (error) {
        consiole.log(error)
      } else {
        if (result.adsState == ads.ADSSTATE.RUN) {
          console.log('The PLC is lucky!')
        }
        console.log('The state is '+ads.ADSSTATE.fromId(result.adsState))
      }
      this.end()
    });
})
```

The following states are possible:
```javascript
  ads.ADSSTATE.INVALID
  ads.ADSSTATE.IDLE
  ads.ADSSTATE.RESET
  ads.ADSSTATE.INIT
  ads.ADSSTATE.START
  ads.ADSSTATE.RUN
  ads.ADSSTATE.STOP
  ads.ADSSTATE.SAVECFG
  ads.ADSSTATE.LOADCFG
  ads.ADSSTATE.POWERFAILURE
  ads.ADSSTATE.POWERGOOD
  ads.ADSSTATE.ERROR
  ads.ADSSTATE.SHUTDOWN
  ads.ADSSTATE.SUSPEND
  ads.ADSSTATE.RESUME
  ads.ADSSTATE.CONFIG
  ads.ADSSTATE.RECONFIG
  ads.ADSSTATE.STOPPING
```

### Event-Driven Detection of Changes to the Symbol Table

If the symbol table changes because, for instance, a new PLC program is written into the controller, the handles must be ascertained once again. The example below illustrates how changes to the symbol table can be detected.

```javascript

var start = true;

var myHandle = {
    indexGroup: ads.ADSIGRP.SYM_VERSION,
    indexOffset: 0,
    bytelength: ads.BYTE,  
}

var client = ads.connect(options, function() {
    start = true;
    this.notify(myHandle);
})

client.on('notification', function(handle){
    if (start) {
      console.log('symbol table version '+handle.value)
    } else {
      console.log('symbol table changed '+handle.value)
    }
    
    start = false;
})

process.on('SIGINT', function() {
    client.end(function() {
        process.exit()
    })
})

client.on('error', function(error) {
    console.log(error)
})
```

### Something about the bytelength
All possibilities of bytelength described here work with read, write, notificaton, multiread and multiwrite.


If you simply enter a number, reading a value returns a buffer object of length or expecting to write. This can be further processed with the standard functions of buffer.

This mehtode is called RAW read and write.
```javascript
var myHandle = {
    symname: '.TestDoubleIntStruct',  
    bytelength: 2,  
    propname: 'value'      
}
var client = ads.connect(options, function() {
    myHandle.value = new Buffer(4)
    myHandle.value.writeInt16LE(5, 0)
    myHandle.value.writeInt16LE(5, 2)
    this.write(myHandle, function(err) {
        if (err) console.log(err)
        this.read(myHandle, function(err, handle) {
            if (err) console.log(err)
            console.log(handle.value)
            this.end()
        })
    })
})
```

There are also ready-made objects for reading and writing numeric variables:
```javascript
  ads.BOOL
  ads.BYTE
  ads.WORD
  ads.DWORD
  ads.SINT
  ads.USINT
  ads.INT
  ads.UINT
  ads.DINT
  ads.UDINT
  ads.LINT
  ads.ULINT
  ads.REAL
  ads.LREAL
```

There are also ready-made objects for reading and writing date and time variables:

With this type it is possible to convert the time zone. There are two ways to control this feature. You can add the variable useLocalTimezone to the handle. This is true for defauld. Or you use the function ads.useLocalTimezone().
```javascript
  ads.TIME
  ads.TIME_OF_DAY
  ads.TOD // TIME_OF_DAY alias
  ads.DATE
  ads.DATE_AND_TIME
  ads.DT // DATE_AND_TIME alias
```

```javascript
var myHandle = {
    symname: '.TESTTIME',  
    bytelength: ads.useLocalTimezone(ads.TIME,false),  
    propname: 'value'      
}
```

```javascript
var myHandle = {
    symname: '.TESTTIME',
    useLocalTimezone: false,
    bytelength: ads.TIME,  
    propname: 'value'      
}
```

The type ads.STRING is fix for 80 characters. Therefore you can use the ads.string(length) function.
```javascript
var myHandle = {
    symname: '.SOMETEXT80',  
    bytelength: ads.STRING,  
    propname: 'value'      
}
```

```javascript
var myHandle = {
    symname: '.SOMETEXT10',  
    bytelength: ads.string(10),  
    propname: 'value'      
}
```

There is also a possibility to read and write arrays.
This is done via the function ads.array(type, lowIndex, hiIndex). The low index and the hi index must be the same as in the twincat definition
On reading the Value is an array, on writing the Value must be an array.
The array under node always starts with 0, independently as loIndex and hiIndex are given.
```javascript
var myHandle = {
    symname: '.SOMEINTARREY',  
    bytelength: ads.array(ads.INT,0,9),  
    propname: 'value'      
}
```

You can also read and write structures. An array is passed for bytelength. Then an array with the same number of parameters is expected in propname.
The structur is mapped binary, so it must be described exactly how it exists in the PLC.
```javascript
var myHandle = {
    symname: '.SOMESTRUCTURE',  
    bytelength: [ ads.BOOL, 
                  ads.array(ads.INT,0,9),
                  ads.array(ads.string(10),0,9),
                  ads.array(ads.useLocalTimezone(ads.TIME,false),0,9)
                 ],  
    propname: ['value.abool',
               'value.aarrayofint',
               'value.aarrayofstring',
               'value.aarrayoftime']
}
```


License (MIT)
-------------
Copyright (c) 2012 Inando

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
