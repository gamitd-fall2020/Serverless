var aws = require("aws-sdk");
var crypt = require('crypto');
var ses = new aws.SES({ region: "us-east-1" });
var DynamoDB = new aws.DynamoDB.DocumentClient();

require('dotenv').config();

exports.handler = (event, context, callback) => {

    let message = JSON.parse(event.Records[0].Sns.Message);

    console.log(JSON.stringify(message));
   
    let qid = message.question.question_id
    let quid = message.ToAddresses.id
    let aid = message.answer.answer_id
    let auid = message.user.id
    let uanswer = message.updatedAnswerText
    let method = message.type
    let question = message.question;
    let answer = message.answer;
    

    let combination = "";

    if(method === 'POST')
        combination = quid + qid + auid + answer.answer_text + method
    else if(method === 'UPDATE')
        combination = quid + qid + auid + aid + uanswer + method
    else
        combination = quid + qid + auid + aid + method

    let SHA= crypt.createHash('sha256');
    SHA.update(combination);
    let HASH = SHA.digest('hex');

    let searchParams = {
        TableName: "csye6225",
        Key: {
            "email_hash": HASH
        }
    };

    console.log("Checking if record already present in DB!!");

    DynamoDB.get(searchParams, function(error, record){
        
        if(error) {

            console.log("Error in DynamoDB get method ",error);

        } else {

            console.log("Success in get method dynamoDB", record);
            console.log(JSON.stringify(record));
            let isPresent = false;

            if (record.Item == null || record.Item == undefined) {
                isPresent = false;
            } else {
                if(record.Item.ttl < Math.floor(Date.now() / 1000))
                    isPresent = false;
                else
                    isPresent = true;
            }

            if(!isPresent) {
                const current = Math.floor(Date.now() / 1000)
                let ttl = 60 * 5
                const expiresIn = ttl + current
                const params = {
                    Item: {
                        email_hash: HASH,
                        ttl: expiresIn,
                        time_created: new Date().getTime(),
                    },
                    TableName: "csye6225"
                }

                DynamoDB.put(params, function (error, data) {
                    if (error){
                        console.log("Error in putting item in DynamoDB ", error);
                    } 
                    else {
                        sendEmail(message, question, answer);
                    }
                });
                
            } else {
                console.log("Item already present. No email sent!");
            }
        }
    })
};

var sendEmail = (data, question, answer) => {

    let temp = "";
    let update= "There was an update to your question";
    let links = "Click here to view your Question: https://"+data.questionGetApi+"\n"+
                "Click here to view Answer posted: https://"+data.answerGetApi+"\n";
    let uanswer = "";
    
    if(data.type === "UPDATE"){
        temp = "Old ";
        uanswer = "Updated Answer Text: "+data.updatedAnswerText+"\n"
    }

    let body = "Hello "+ data.ToAddresses.first_name +",\n\n"+
        update+".\n\n\n"+
        "Question Details\n"+
        "Question ID: "+question.question_id+"\n"+
        "Question Text: "+question.question_text+"\n\n\n"+
        "Answer Details\n"+
        "Answer ID: "+answer.answer_id+"\n"+
        temp+"Answer Text: "+answer.answer_text+"\n"+
        uanswer+
        "Answered By: "+data.user.first_name+" "+data.user.last_name+"\n\n\n"+
        links

    let from = "no-reply@"+process.env.DOMAIN
    let emailParams = {
        Destination: {
            ToAddresses: [data.ToAddresses.username],
        },
        Message: {
            Body: {
                Text: { Data: body },
            },
            Subject: { Data: "Question Notification" },
        },
        Source: from,
    };

    let sendEmailPromise = ses.sendEmail(emailParams).promise()
    sendEmailPromise
        .then(function(result) {
            console.log(result);
        })
        .catch(function(err) {
            console.error(err, err.stack);
        });
}