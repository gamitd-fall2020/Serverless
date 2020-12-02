var aws = require("aws-sdk");
var ses = new aws.SES({ region: "us-east-1" });
var dynamo = new aws.DynamoDB.DocumentClient();
var crypto = require('crypto');
require('dotenv').config();

exports.handler = (event, context, callback) => {

    let message = JSON.parse(event.Records[0].Sns.Message);

    console.log(JSON.stringify(message));

    let dataQuestion = message.question;
    let dataAnswer = message.answer;

    let newObject = {

        question_user_id : message.ToAddresses.id,
        question_id: dataQuestion.question_id,
        answer_user_id: message.user.id,
        answer_id: dataAnswer.answer_id,
        answer_text: message.updatedAnswerText,
        type: message.type

    };

    let stringToHash = message.ToAddresses.id+","+dataQuestion.question_id+","+
        message.user.id+","+dataAnswer.answer_id+","+message.type;

    if(message.type === 'POST'){
        stringToHash = message.ToAddresses.id+","+dataQuestion.question_id+","+
            message.user.id+","+dataAnswer.answer_text+","+message.type;
    }

    let shasum = crypto.createHash('sha256');
    shasum.update(stringToHash);
    let calculatedHash = shasum.digest('hex');

    let searchParams = {
        TableName: "csye6225",
        Key: {
            "email_hash": calculatedHash
        }
    };

    console.log("Checking if record already present in DB!!");

    dynamo.get(searchParams, function(error, retrievedRecord){
        
        if(error) {

            console.log("Error in DynamoDB get method ",error);

        } else {

            console.log("Success in get method dynamoDB", retrievedRecord);
            console.log(JSON.stringify(retrievedRecord));
            let found = false;
            let isSameAnswer = false;
            if (retrievedRecord.Item == null || retrievedRecord.Item == undefined) {

                found = false;

            } else {

                if(retrievedRecord.Item.answer_text === newObject.answer_text)
                {
                    isSameAnswer = true;
                }

                found = true;

            }

            if(!found) {

                const current = Math.floor(Date.now() / 1000)
                let timeToLive = 60 * 60 * 24 * 10
                const expireWithIn = timeToLive + current
                let answerToShow = dataAnswer.answer_text
                if(message.type === 'UPDATE')
                    answerToShow = newObject.answer_text
                const params = {
                    Item: {
                        email_hash: calculatedHash,
                        ttl: expireWithIn,
                        question_user_id: newObject.question_user_id,
                        question_id: newObject.question_id,
                        answer_user_id: newObject.answer_user_id,
                        answer_id: newObject.answer_id,
                        answer_text: answerToShow,
                        time_created: new Date().getTime(),
                        type: newObject.type
                    },
                    TableName: "csye6225"
                }

                if(message.type === 'DELETE'){

                    let searchParams = {
                        TableName: "csye6225",
                        ProjectionExpression: "#qid, #aid, email_hash",
                        FilterExpression: "#qid = :question_id AND #aid = :answer_id",
                        ExpressionAttributeNames:{
                            "#qid" : "question_id",
                            "#aid" : "answer_id"
                        },
                        ExpressionAttributeValues: {
                            ":question_id": newObject.question_id,
                            ":answer_id": newObject.answer_id
                        }
                    }
                    console.log("Scanning Dynamo to delete records for the answer deleted....")
                    dynamo.scan(searchParams, function (error, data){
                        if(error){
                            console.log("Error in scanning of DynamoDB....");
                        } else {
                            console.log("Scan succeeded...");
                            data.Items.forEach(function (record){
                                console.log(record)
                                let deleteParams = {
                                    TableName: "csye6225",
                                    Key: {
                                        email_hash: record.email_hash
                                    }
                                }
                                dynamo.delete(deleteParams, function (error, data){
                                    if(error) console.log("Error in deleting record...",error);
                                    else console.log("Deleted record successfully....");
                                })
                            })
                        }
                    });
                    sendEmail(message, dataQuestion, dataAnswer)
                } else {
                    dynamo.put(params, function (error, data) {
                        if (error){
                            console.log("Error in putting item in DynamoDB ", error);
                        } 
                        else {
                            sendEmail(message, dataQuestion, dataAnswer);
                        }
                    });
                }
            } else {

                if(message.type === 'UPDATE' && !isSameAnswer){
                    let params = {
                        Key: {
                            email_hash: calculatedHash
                        },
                        TableName : "csye6225",
                        AttributeUpdates: {
                            answer_text: {
                                Action: "PUT",
                                Value: newObject.answer_text
                            }
                        }
                    }

                    dynamo.update(params, function (error, data){
                        if(error) {
                            console.log(error)
                        } else {
                            console.log("Updated item successfully in DynamoDB...", JSON.stringify(data));
                            console.log("Sending email of Update...");
                            sendEmail(message, dataQuestion, dataAnswer);
                        }
                    });

                } else {
                    console.log("Item already present. No email sent!");
                }
            }
        }
    })
};

var sendEmail = (message, dataQuestion, dataAnswer) => {

    let updateTemplate= "";
    let apiTemplate = "";
    let oldTemplate = "";
    let newAnswerTemplate = "";

    if(message.type === "POST")
        updateTemplate = "An answer is posted to your Question By ";
    else if(message.type === "UPDATE"){
        updateTemplate = "An answer posted to your Question was Updated By ";
        oldTemplate = "Old ";
        newAnswerTemplate = "Updated Answer Text: "+message.updatedAnswerText+"\n"
    }else
        updateTemplate = "An answer posted to your Question was deleted By ";

    if(message.type === "POST")
        apiTemplate = "Click here to view your Question: http://"+message.questionGetApi+"\n"+
            "Click here to view Answer posted: http://"+message.answerGetApi+"\n"
    else if(message.type === "UPDATE")
        apiTemplate = "Click here to view your Question: http://"+message.questionGetApi+"\n"+
            "Click here to view Updated Answer: http://"+message.answerGetApi+"\n"
    else 
        apiTemplate = "Click here to view your Question: http://"+message.questionGetApi+"\n"


    let data = "Hello "+ message.ToAddresses.first_name +",\n\n"+
        updateTemplate + message.user.first_name+".\n\n\n"+
        "QUESTION DETAILS\n"+
        "------------------------------------------\n"+
        "Question ID: "+dataQuestion.question_id+"\n"+
        "Question Text: "+dataQuestion.question_text+"\n\n\n"+
        "ANSWER DETAILS\n"+
        "------------------------------------------\n"+
        "Answer ID: "+dataAnswer.answer_id+"\n"+
        oldTemplate+"Answer Text: "+dataAnswer.answer_text+"\n"+
        newAnswerTemplate+
        "Answered By: "+message.user.first_name+" "+message.user.last_name+"\n\n\n"+
        apiTemplate

    let fromMail = "no-reply@"+process.env.DOMAIN
    let emailParams = {
        Destination: {
            ToAddresses: [message.ToAddresses.username],
        },
        Message: {
            Body: {
                Text: { Data: data
                },
            },

            Subject: { Data: "Question Notification" },
        },
        Source: fromMail,
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