/* eslint no-fallthrough: off */
/* eslint-env node, browser */
var postMessage;
var listenerFn = function(evt) {
  switch(evt.data && evt.data.action || evt.action) {
    case 'domReady':
      // no break - we want it to go to the next case
    case 'getData':
      //not sending the message if there are requests in queue
      if(!self.pendingSend && self.processedData[evt.data && evt.data.period || evt.period || 'day']) {
        postMessage({
          action: 'update',
          wsData: self.processedData[evt.data && evt.data.period || evt.period || 'day']
        });
        self.pendingSend = false;
      } else {
        self.pendingSend = true;
      }
      break;
  }
};

if(typeof window !== 'undefined' && window === self) {
  window.worker = {
    postMessage: listenerFn
  };
  postMessage = function(simulatedEvent) {
    window.main.call(simulatedEvent);
  };
} else {
  postMessage = self.postMessage;
  self.onmessage = listenerFn;
}

var iqr = require('compute-iqr');
var Papa = require('papaparse');

self.dataReady = false;
self.pendingSend = false;
self.initialDataSent = false;

self.processedData = {
  day: null,
  week: null,
  month: null,
  all: null
};

function update(callback) {
  Papa.parse(typeof window !== 'undefined' ? 'sasping_data_latest.csv' : '../sasping_data_latest.csv', {
    download: true,
    error: function(err) {
      var errMsg = typeof err === 'string' ? err : (err.message || 'no message');
      postMessage({
        action: 'error',
        msg: 'Error loading CSV file with message: ' + errMsg
      });
    },
    complete: function(papaParsedObj) {
      var now = new Date();
      var dayOldTimestamp = new Date().setDate(now.getDate() - 1);
      self.processedData.day = processData(papaParsedObj.data, dayOldTimestamp);

      if(callback) {
        callback();
      }

      setTimeout(function() {
        updateWeek();
        updateMonth();
        updateAll();
      }, 0);
    }
  });
}

update(function() {
  if(!self.initialDataSent && self.pendingSend) {
    postMessage({
      action: 'update',
      wsData: self.processedData.day
    });
    self.initialDataSent = true;
    self.pendingSend = false;
  }
});

// retrieve all time periods data and process it in web worker every 10 minutes
// not sending update messages to UI - it's updated when time period is changed
setInterval(update, 10 * 60 * 1000);

function updateWeek() {
  Papa.parse(typeof window !== 'undefined' ? 'sasping_data_week.csv' : '../sasping_data_week.csv', {
    download: true,
    error: function(err) {
      var errMsg = typeof err === 'string' ? err : (err.message || 'no message');
      postMessage({
        action: 'error',
        msg: 'Error loading CSV file with message: ' + errMsg
      });
    },
    complete: function(papaParsedObj) {
      var now = new Date();
      var weekldTimestamp = new Date().setDate(now.getDate() - 7);
      self.processedData.week = processData(papaParsedObj.data, weekldTimestamp);
    }
  });
}
function updateMonth() {
  Papa.parse(typeof window !== 'undefined' ? 'sasping_data_month.csv' : '../sasping_data_month.csv', {
    download: true,
    error: function(err) {
      var errMsg = typeof err === 'string' ? err : (err.message || 'no message');
      postMessage({
        action: 'error',
        msg: 'Error loading CSV file with message: ' + errMsg
      });
    },
    complete: function(papaParsedObj) {
      var now = new Date();
      var monthOldTimestamp = new Date().setMonth(now.getMonth() - 1);
      self.processedData.month = processData(papaParsedObj.data, monthOldTimestamp);
    }
  });
}
function updateAll() {
  Papa.parse(typeof window !== 'undefined' ? 'sasping_data_allTime.csv' : '../sasping_data_allTime.csv', {
    download: true,
    error: function(err) {
      var errMsg = typeof err === 'string' ? err : (err.message || 'no message');
      postMessage({
        action: 'error',
        msg: 'Error loading CSV file with message: ' + errMsg
      });
    },
    complete: function(papaParsedObj) {
      self.processedData.all = processData(papaParsedObj.data, 0);
    }
  });
}

function processData(data, timestamp) {
  if(data[data.length - 1].length === 1) data.pop(); //remove last row if it's empty

  var processedData = {
    uptime: null,
    avgResponse: null,
    avgLogin: null,
    iqr: null,
    apps: {},
    chartData: {
      login: [],
      call: []
    }
  };
  var count = {
    total: 0,
    failed: 0,
    login: 0,
    call: 0
  };
  var time = {
    login: 0,
    call: 0
  };

  var i, execTime, execDuration, iqrData, lastExecCallData;
  var failedCheckFn = function(status) {
    return !status;
  };

  iqrData = [];
  for(i = data.length-1; i >= 0; i--) {
    if(data[i][2] * 1000 < timestamp) break; //not in period/timespan

    count.total++;
    if(!data[i][1]) count.failed++;
    if(data[i][0] === 'sasping login request') {
      count.login++;
      execTime = Number(data[i][6]) * 1000;
      execDuration = data[i][3] * 1000;
      time.login += execDuration;

      processedData.chartData.login.push([
        execTime,
        execDuration,
        !data[i][1] // is failed
      ]);
    } else {
      count.call++;
      execDuration = data[i][3] * 1000;
      time.call += execDuration;
      execTime = Number(data[i][6]) * 1000;

      lastExecCallData = processedData.chartData.call[processedData.chartData.call.length - 1];
      if(lastExecCallData === undefined || lastExecCallData[0] !== execTime) {
        processedData.chartData.call.push([
          execTime,
          [execDuration],
          [!data[i][1]] // is failed
        ]);
      } else {
        lastExecCallData[1].push(execDuration);
        lastExecCallData[2].push(!data[i][1]);
      }

      //add to apps
      if(data[i][5]) {
        if(processedData.apps[data[i][5]] === undefined) {
          processedData.apps[data[i][5]] = {
            data: [{
              id: data[i][0],
              x: data[i][2] * 1000,
              execTime: data[i][6] * 1000,
              y: execDuration,
              failed: !data[i][1]
            }]
          };
        } else {
          processedData.apps[data[i][5]].data.push({
            id: data[i][0],
            x: data[i][2] * 1000,
            execTime: data[i][6] * 1000,
            y: execDuration,
            failed: !data[i][1]
          });
        }
      }
    }
    iqrData.push(execDuration);
  }

  //set app health status
  for(var appName in processedData.apps) {
    var lastExecTime = processedData.apps[appName].data[0].execTime;
    var lastExecStatuses = [];
    i = 0;
    while(lastExecTime === processedData.apps[appName].data[i].execTime) {
      lastExecStatuses.push(!processedData.apps[appName].data[i++].failed);
    }
    if(lastExecStatuses.every(failedCheckFn)) {
      processedData.apps[appName].health = 'red';
    } else if(lastExecStatuses.some(failedCheckFn)) {
      processedData.apps[appName].health = 'orange';
    } else {
      processedData.apps[appName].health = 'green';
    }

    // group app data by execution
    var curAppData = processedData.apps[appName].data;
    var lastInd = 0;
    processedData.apps[appName].dataGroupedByExec = [{
      x: curAppData[0].x,
      y: [curAppData[0].y]
    }];
    for(i = 1; i < curAppData.length; i++) {
      lastInd = processedData.apps[appName].dataGroupedByExec.length - 1;
      // if they are not equal, add new row and replace y array with average value
      if(curAppData[i-1].execTime !== curAppData[i].execTime) {
        processedData.apps[appName].dataGroupedByExec[lastInd].y = avg(processedData.apps[appName].dataGroupedByExec[lastInd].y);
        processedData.apps[appName].dataGroupedByExec.push({
          x: curAppData[i].x,
          y: [curAppData[i].y]
        });
      } else {
        processedData.apps[appName].dataGroupedByExec[lastInd].y.push(curAppData[i].y);
      }
    }
    // replace last y array with average value
    lastInd = processedData.apps[appName].dataGroupedByExec.length - 1;
    processedData.apps[appName].dataGroupedByExec[lastInd].y = avg(processedData.apps[appName].dataGroupedByExec[lastInd].y);
  }

  for(i = 0; i < processedData.chartData.call.length; i++) {
    processedData.chartData.call[i][1] = avg(processedData.chartData.call[i][1]);
    // combine isFailed
    // set call[i][2] = true (failed) if there's at least one failed request
    processedData.chartData.call[i][2] = processedData.chartData.call[i][2].some(function(val) {
      return val === true;
    });
  }
  processedData.iqr = Math.round(iqr(iqrData));

  if(count.total !== 0) {
    // toFixed(2) will round the number
    processedData.uptime = ((count.total - count.failed) / count.total).toString().substr(0, 4);
    if(count.call) {
      processedData.avgResponse = Math.round(time.call / count.call);
    }
    if(count.login) {
      processedData.avgLogin = Math.round(time.login / count.login);
    }
  }

  return processedData;
}

function avg(arr) {
  var sum = 0;
  for(var i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum / arr.length;
}
