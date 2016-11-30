var express = require("express")
var SparkClient = require("node-sparkclient")
var bodyParser = require('body-parser');
var Promise = require('bluebird')
var request = require('request')
var _ = require("lodash")

var spark_access_token = process.env.SPARK_TOKEN
var relayr_token = process.env.RELAYR_TOKEN
var sparkClient = new SparkClient(spark_access_token)
var userlist = ['salesdemo@relayr.io']
var ecalationList = ['michael.omalley@relayr.io']
var deviceId = "fb90d41d-3671-4c13-aba5-85dccd199703"

function add_user_to_room(roomid, email)
{
  return new Promise(function(resolve,reject) {
     sparkClient.createMembership(roomid,email,function(err,membership) {
       if (err)
       {
         reject(err)
       }
       else {
         resolve(membership)
       }
     })
  })
}

function create_room(room_title)
{
  return new Promise(function(resolve,reject) {
     sparkClient.createRoom(room_title,function(err,room){
       if (err)
       {
         reject(err)
       }
       else {
         resolve(room)
       }
     })
  })
}

function post_message(roomid, message)
{
  return new Promise(function(resolve,reject) {
     sparkClient.createMessage(roomid,message,{markdown:true},function(err,message){
       if (err)
       {
         reject(err)
       }
       else {
         resolve(message)
       }
     })
  })

}

function getReading(token,deviceId) {
  return new Promise(function(resolve,reject) {
     var url  = "https://api.relayr.io/devices/"+deviceId+"/readings"
     request(
        {
            method: 'GET'
            , headers: { 'Content-Type': 'application/json','Cache-Control': 'no-cache'}
            , uri: url
            , 'auth': {'bearer': relayr_token }
        }
        , function (error, response, body) {
            if(error) {
                reject(error)
            }
            else if (response.statusCode == 200) {
                try {
                    resolve(JSON.parse(body))
                }
                catch (e)
                {
                    reject(e)
                }
            } else {
                try {
                    resolve(JSON.parse(body))
                }
                catch(e)
                {
                    reject(e)
                }
            }

        })
  })
}
var app = express()
app.use(bodyParser.json());

app.post('/relayr_event', function (req, res) {
  res.send('ok')
  console.log("<------Incoming Web Hook --------->")
  var webhook = req.body
  console.log(JSON.stringify(webhook,null,2))

  var subject  = webhook.subject ? webhook.subject : "Relayr Exception"

  create_room(subject)
  .then(function(room){

    return Promise.map(userlist, function (email) {
              console.log("Adding: "+email)
              return add_user_to_room(room.id,email)
    },{concurrency:1})
    .then(function(emails){
      message = webhook.msg ? webhook.msg : "We have noticed the machine has been off for 5 minutes"
      return post_message(room.id, message)
    })
  })
 })

 app.post('/relayr_users', function (req, res) {
   res.send('ok')
   console.log("<------Change User List --------->")
   userlist = req.body.userList
   ecalationList = req.body.ecalationList
   console.log(JSON.stringify(body,null,2))
 })

 app.post('/webhook', function (req, res) {
   res.send('ok')
   console.log("<------Incoming Web Hook --------->")
   var webhook = req.body

   console.dir(webhook)
   if (webhook && webhook.resource =='messages' && webhook.event == 'created' && webhook.data.personEmail != 'relayr@sparkbot.io')
   {
      sparkClient.getMessage(webhook.data.id, function(err,message){
        if (!err)
        {
           var regex_escalate = /escalate/i
           var regex_resolve = /resolve/i
           var regex_reading = /\/getreading(.*)/i
           escalate = message.text.match(regex_escalate)
           resolve = message.text.match(regex_resolve)
           getreading = message.text.match(regex_reading)
           console.dir(escalate)
           if (escalate)
           {
                post_message(message.roomId,"Alright I've escalated and added the manager to the room")
                .then(function(newmessage){
                  Promise.map(ecalationList, function (email) {
                            console.log("Escalation Adding: "+email)
                            return add_user_to_room(message.roomId,email)
                  },{concurrency:1})
                })
            // add person to room
           }
           else if (resolve)
           {
             post_message(message.roomId,"Ok, glad the issue was resolved! Closing the Spark session.")
             .then(function(newmessage){
               sparkClient.deleteRoom(message.roomId,function(err,room) {

                if (err)
                  console.error("got an error:" + err);
                else {
                  console.log("deleted the room");
                }
               })
             })

           }
           else if (getreading){
             if (getreading.length > 1)
             {
               var sensor = getreading[1].trim()
               getReading(relayr_token,deviceId)
               .then(function(reading){
                 console.dir(reading)
                 sensorObject = _.find(reading.readings, { 'meaning': sensor });
                 if (sensorObject) {
                   post_message(message.roomId,"The reading for "+sensor+" is: "+sensorObject.value )
                 }
                 else {
                   post_message(message.roomId,"Sorry could not find sensor named:"+sensor+" on the device.")
                 }
               })
               .catch(function(e){
                 console.dir(e)
               })
             }
             else {
               post_message(message.roomId,"Please specify a sensor to get a reading from.")

             }

           }
        }
        else {
          console.dir(err)
        }
      })


   }

 })
app.listen(3000, function () {
  console.log('relayr app listening on port 3000!')
})
