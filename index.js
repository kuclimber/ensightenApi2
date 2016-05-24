var btoa = require('btoa'); //Used to create the base-64 encoded string for the Bearer Key request
var request = require('request'); // Used to facilitate the API requests
var prompt = require('prompt'); // USed for the prompts
var fs = require('fs'); // Used to save files
var json2csv = require('json2csv'); // Used to convert JSON to CSV for Export Functions
var nestedjson2csv = require('nestedjson2csv'); // Used to convert JSON to CSV for Export Functions
var querystring = require('querystring');
var authKey = '';
var bearerKey = '';
var spaceNames = [];
var spaceIds = [];
var activeSpace = {};

/* login object has methods responsible for creating the Bearer Key and getting the basic info about the account*/
var login = {

    /* Prompts user for account, username and password 
     * Calls method to create Base64 string
     * Calls method to get Bearer Token
     */
    authenticationStart: function() {
        prompt.start();
        prompt.get(['Account', 'Username', 'Password', ], function(err, result) {
            authKey = login.parseAuthCreds(result);
            bearerKey = login.getBearerkey(authKey);

        });
    },

    /* Takes in results from prompts
     * Concatenates and returns the base-64 string */
    parseAuthCreds: function(loginInfo) {
        return btoa(loginInfo.Account + ':' + loginInfo.Username + ':' + loginInfo.Password);
    },

    /* API Call for Bearer Token*/
    getBearerkey: function(authKey) {
        request({
            method: 'POST',
            url: 'https://manage-api.ensighten.com/auth/token',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + authKey
            },
            body: 'grant_type=password'
        }, function(error, response, body) {
            var results = JSON.parse(body);
            if (response.statusCode !== 200) {
                console.log('***Authentication Error***');
                console.log(results.message);
                console.log(results.description);
                console.log('\nPlease try Again')
                login.authenticationStart();
            } else {
                bearerKey = results.access_token;
                login.getAccountinfo(results.access_token);
            }
        });
    },

    /* Api Request for all the spaces in the account
     * Calls method to create arrays of Space Names & IDs
     * Calls method asking user which space they want to work in */
    getAccountinfo: function(bearerKey) {
        request({
                method: 'GET',
                url: 'https://manage-api.ensighten.com/manage/spaces?',
                headers: {
                    'Authorization': 'Bearer ' + bearerKey,
                    'Accept': 'application/json'
                }
            },
            function(error, response, body) {
                var spaces = JSON.parse(body);
                login.createSpaceArrays(spaces);
                login.promptForSpace();
            });
    },

    /* Method used to create the Id & Name Arrays 
     * Also Displays the Name & ID for the user to see so they can make thier choice*/
    createSpaceArrays: function(accountObject) {
        console.log('\nThis account has the following Spaces:');
        for (var i = 0; i < accountObject.length; i++) {
            spaceNames[i] = accountObject[i].name;
            spaceIds[i] = accountObject[i].id;
            console.log('id ' + i + ': ' + spaceNames[i] + ': ' + spaceIds[i]);
        }
    },

    /* prompt requesting space the user desires to work in
     * based on their selection, the chosen space name & ID are assigned to the activeSpace Object
     * Transitions the User from the 'Setup Phase' the 'Action phase' by calling the action.promptForCommand method*/
    promptForSpace: function() {
        console.log('\nPlease select the space you would like to work in');
        prompt.start();
        prompt.get(['ID'], function(err, result) {
            activeSpace.name = spaceNames[result.ID];
            activeSpace.id = spaceIds[result.ID];
            actions.promptForCommand(activeSpace, bearerKey);
        })
    }
}

/* actions object conatins all the Methods that are used to do things in this program */
var actions = {

    /* Default Method to start taking actions in the interface
     * Prompts user for what Action they desire to take
     * Calls appropriate method dependent on what action is desired */
    promptForCommand: function(activeSpace, bearerKey) {
        console.log('\nWhat would you like to do?');
        console.log('1: Export csv of existing deployments.');
        console.log('2: Export csv of conditions.');
        console.log('3: Create a new deployments.');
        console.log('4: Exit');
        prompt.start()
        prompt.get(['Option'], function(err, result) {
            if (result.Option == '1') {
                actions.exportDeployments(activeSpace, bearerKey);
            } else if (result.Option == '2') {
                actions.exportConditions.getConditions(activeSpace, bearerKey);
            } else if (result.Option == '4') {
                process.exit();
            } else if (result.Option == '3') {
                actions.createDeployment.provideDeploymentName(activeSpace, bearerKey);
            }
        });
    },

    /* Api call that outputs basic information on all deployments within the Active Space
     * Converts returned JSON object to CSV and saves output */
    exportDeployments: function(activeSpace, bearerKey) {
        var fileName = activeSpace.name.replace(' ', '_') + '_deployments.csv';
        request({
            method: 'POST',
            url: 'https://manage-api.ensighten.com/manage/deployments/search',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + bearerKey,
                'Accept': 'application/json'
            },
            body: '{  \"fields\": \"id, name, code, status, labels, creationDate\", \"sort\": \"+name\", \"filters\": {    \"spaceId\": [' + activeSpace.id + ']  }}'
        }, function(error, response, body) {
            console.log(response.statusCode)
            var results = JSON.parse(body);
            if (response.statusCode !== 200) {
                console.log('***Error***');
            }
            var deployments = JSON.parse(body);
            var fields = ['id', 'name', 'code', 'status', 'labels', 'creationDate'];


            json2csv({
                data: deployments,
                fields: fields
            }, function(err, csv) {
                if (err) console.log(err);
                fs.writeFile(fileName, csv, function(err) {
                    if (err) throw err;
                    console.log('file saved');
                });
            });
        });

    },

    /*this set of methods is used to get the export the conditions in the selected spaces*/


    exportConditions: {
        /* method takes in the JSON object of conditions, and filters it down to only the conditions that used in the active space */
        filterConditionstoActiveSpace: function(activeSpace, conditions) {
            var cArray = [];

            for (var i = 0; i < conditions.length; i++) {
                for (var j = 0; j < conditions[i].deployments.length; j++) {
                    if (conditions[i].deployments[j].spaceId == activeSpace.id) {
                        cArray.push(conditions[i]);
                        break;
                    }
                }
            }

            return JSON.stringify(cArray);
        },

        /*This method calls a seperate API which will parse the returned JSON and prepare a CSV value*/
        callJsonParseApi: function(selectedConditons, fileName) {
            var form = {
                email: 'kuclimber@gmail.com',
                json: selectedConditons
            }

            var formData = querystring.stringify(form);

            request({
                    method: 'POST',
                    url: 'https://json-csv.com/api/getcsv',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: formData

                },
                function(error, response, body) {
                    fs.writeFile(fileName, body, function(err) {
                        if (err) throw err;
                        console.log('file saved');readAsDataURL(file|blob)
                        actions.promptForCommand(activeSpace, bearerKey);
                    });
                });
        },

        /* This Method is the inital request to the Ensighten API for the conditions
         * returns all conditions in the account */
        getConditions: function(activeSpace, bearerKey) {

            var fileName = activeSpace.name.replace(' ', '_') + '_conditions.csv';
            request({
                method: 'GET',
                url: 'https://manage-api.ensighten.com/manage/conditions',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + bearerKey,
                },
            }, function(error, response, body) {
                console.log(response.statusCode)


                if (response.statusCode !== 200) {
                    console.log('***Error***');
                }
                var conditions = JSON.parse(body);
                var selectedConditons = actions.exportConditions.filterConditionstoActiveSpace(activeSpace, conditions);
                actions.exportConditions.callJsonParseApi(selectedConditons, fileName);
            });
        }
    },

    /* The createDeployment object houses all the methods that are needed to create a new deployement via the API
     * Methods within this object cascade on into the other collecting the minimal information to build a deployment*/
    createDeployment: {

        /* Creates deploymentInfo object which will hold all info needed for the API call
         * Prompts user for the new Deployment name assigns to deploymentInfo Object
         * Calls method to provide code */
        provideDeploymentName: function(activeSpace, bearerKey) {
            deploymentInfo = {};
            deploymentInfo.spaceId = activeSpace.id;
            console.log('\nPlease provide the deployment name')

            prompt.start();
            prompt.get(['name'], function(err, result) {
                deploymentInfo.name = result.name;
                actions.createDeployment.provideCode(deploymentInfo);
            });
        },
        /* Prompts user for the code for the deployment assigns to deploymentInfo Object
         * Calls method to Select Condition */
        provideCode: function(deploymentInfo) {
            console.log('\nProvide Code');
            prompt.start();
            prompt.get(['code'], function(err, result) {
                deploymentInfo.code = result.code;
                actions.createDeployment.selectCondition(deploymentInfo);
            });
        },

        /* Prompts user for the condition ID that should be used for the deployment assigns to deploymentInfo Object
         * If user can't/doesn't provide one, the global asynchronus condition is default
         * Calls method to Select execution time */
        selectCondition: function(deploymentInfo) {
            console.log('\nPlease provide the condition id you would like to use\nIf none is provided the "Global Asynchronus" condition will be applied (just press enter)');
            prompt.start();
            prompt.get(['condition'], function(err, result) {
                if (result.condition === '') {
                    deploymentInfo.conditions = '423085'
                    actions.createDeployment.selectExecutionTime(deploymentInfo);
                } else {
                    deploymentInfo.conditions = result.condition;
                    actions.createDeployment.selectExecutionTime(deploymentInfo);
                }
            })
        },

        /* Displays the 3 options for execution time
         * Prompts User to select one of the options
         * If invalid selection is chosen, repeats
         * after valid selection assigns to deploymentInfo Object
         * calls method to provide comments */
        selectExecutionTime: function(deploymentInfo) {
            console.log('\nPlease select the time that the deployment should run:');
            console.log('1: Immediate');
            console.log('2: On Dom Ready');
            console.log('3: On Page Complete');
            prompt.start();
            prompt.get(['selection_id'], function(err, results) {
                if (results.selection_id == '1') {
                    deploymentInfo.timing = 'immediate';
                    actions.createDeployment.provideComments(deploymentInfo);
                } else if (results.selection_id == '2') {
                    deploymentInfo.timing = 'dom_parsed';
                    actions.createDeployment.provideComments(deploymentInfo);
                } else if (results.selection_id == '3') {
                    deploymentInfo.timing = 'dom_loaded';
                    actions.createDeployment.provideComments(deploymentInfo);
                } else {
                    console.log('\nInvalid Selection')
                    actions.createDeployment.selectExecutionTime(deploymentInfo);
                }

            })
        },

        /* prompts for any comments that should be included with the deployment
         * assigns to the deploymentInfo object
         * calls method that makees the API call to create the deployment*/
        provideComments: function(deploymentInfo) {
            console.log('\nPlease provide any comments associated with the deployment')
            prompt.start();
            prompt.get(['comments'], function(err, result) {
                deploymentInfo.comments = result.comments
                actions.createDeployment.submitDeployment(deploymentInfo, bearerKey);
            })
        },

        /* Runs API call to create the new Deployment */
        submitDeployment: function(deploymentInfo, bearerKey) {
            request({
                method: 'POST',
                url: 'https://manage-api.ensighten.com/manage/spaces/' + deploymentInfo.spaceId + '/deployments',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + bearerKey,
                    'Accept': 'application/json'
                },
                body: '{  "name": "' + deploymentInfo.name + '", "executionTime": "' + deploymentInfo.timing + '", "comments": "' + deploymentInfo.comments + '","code": "' + deploymentInfo.code + '", "conditionIds":[' + deploymentInfo.conditions + ']}'
            }, function(error, response, body) {
                var results = JSON.parse(body);
                if (response.statusCode == '201') {
                    console.log('\nThe deployment was successfully created');
                    console.log('The new deployment id is:' + results.id);
                } else {
                    console.log('***Error***');
                    console.log(results.message);
                    console.log(results.description);
                }
            });
        }
    }
}

/* Initializes the Command Line API Interface*/
login.authenticationStart();