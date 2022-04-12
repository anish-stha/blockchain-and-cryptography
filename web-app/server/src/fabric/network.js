//Import Hyperledger Fabric 1.4 programming model - fabric-network
'use strict';

const { FileSystemWallet, Gateway, X509WalletMixin } = require('fabric-network');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const uuidv1 = require('uuid/v1');
const hasha = require('hasha');



//connect to the config file
const configPathPrefix = path.join(process.cwd(), 'config');
const walletPathPrefix = path.join(process.cwd(), '_idwallet');
const configPath = path.join(configPathPrefix, 'config.json');
const configJSON = fs.readFileSync(configPath, 'utf8');
const config = JSON.parse(configJSON);
let connection_file = config.connection_file;

let gatewayDiscovery = config.gatewayDiscovery;
let appAdmin = config.appAdmin;
let orgMSPID = config.orgMSPID;
let channelName = config.channel_name;
let smartContractName = config.smart_contract_name;
let peerAddr = config.peerName;

// connect to the connection file
const ccpPath = path.join(configPathPrefix, connection_file);
const ccpJSON = fs.readFileSync(ccpPath, 'utf8');
const ccp = JSON.parse(ccpJSON);

let smtpHost = config.smtpHost;
let smtpPort = config.smtpPort;
let smtpUserName = config.smtpUserName;
let smtpPassword = config.smtpPassword;
let senderEmail = config.senderEmail;

//connect to the blockchain network using username
exports.connectToNetwork = async function(userName) {
    const gateway = new Gateway();
    try {
        const walletPath = path.join(walletPathPrefix);
        const wallet = new FileSystemWallet(walletPath);
        console.log(`Wallet path: ${walletPath}`);

        const userExists = await wallet.exists(userName);
        if (!userExists) {
            console.error('An identity for the user ' + userName + ' does not exist in the wallet');
            console.log('Run the registerUser.js application before retrying');
            let response = {};
            response.err = 'An identity for the user ' + userName + ' does not exist in the wallet. Register ' + userName + ' first';
            return response;
        }

        await gateway.connect(ccp, { wallet, identity: userName, discovery: gatewayDiscovery });

        const network = await gateway.getNetwork(channelName);
        const contract = await network.getContract(smartContractName);
        const client = gateway.getClient();
        const channel = client.getChannel(channelName);
        console.log("+++++++++++++++++++++++++++++++")
        console.log("Get channel peers", channel.getChannelPeers());
        console.log("+++++++++++++++++++++++++++++++")
        let event_hub = channel.newChannelEventHub(peerAddr);


        let networkObj = {
            contract: contract,
            network: network,
            gateway: gateway,
            event_hub: event_hub,
            channel: channel
        };
        return networkObj;

    } catch (error) {
        console.log(`Error processing transaction. ${error}`);
        console.error(error.stack);
        let response = {};
        response.err = error;
        return response;
    } finally {
        console.log('Done connecting to network.');
    }
};

//create a new user object in the blockchain
exports.createUser = async function(networkObj, args) {
    try {
        args = JSON.parse(args[0]);
        let response = await networkObj.contract.submitTransaction('createUser', args.emailAddress, args.firstName, args.lastName);

        await networkObj.gateway.disconnect();

        return response;
    } catch (error) {
        console.error(`Failed to submit transaction: ${error}`);
        return error;
    }
};

//get a list of all digital assets
exports.queryAllDigitalAssets = async function(networkObj, emailAddress) {
    try {

        let response = await networkObj.contract.evaluateTransaction('queryAllDigitalAssets', emailAddress);
        console.log('Transaction queryAllDigitalAssets has been submitted');

        await networkObj.gateway.disconnect();

        return response;
    } catch (error) {
        console.error(`Failed to evaluate transaction: ${error}`);
        return error;
    }
};

//get list of digital assets owned by emailAddress
exports.queryDigitalAssetsByUser = async function(networkObj, emailAddress) {
    try {
        let response = await networkObj.contract.evaluateTransaction('queryDigitalAssetsByUser', emailAddress);
        console.log('Transaction queryDigitalAssetsByUser has been submitted');

        await networkObj.gateway.disconnect();

        return response;
    } catch (error) {
        console.error(`Failed to evaluate transaction: ${error}`);
        return error;
    }
};

//get the hash of an asset
exports.getHashFromAsset = async function(asset) {
    //console.log('Calculating hash from asset');
    let hashOutput = hasha(asset);
    //console.log(`The MD5 sum of the file is: ${hashOutput}`);
    return hashOutput;
};

//read digital asset by assetId
exports.readDigitalAsset = async function(networkObj, assetId) {
    try {
        let response = await networkObj.contract.submitTransaction('readDigitalAsset', assetId);
        console.log('Transaction readDigitalAsset has been submitted');

        await networkObj.gateway.disconnect();

        return response;
    } catch (error) {
        console.error(`Failed to evaluate transaction: ${error}`);
        return error;
    }
};

//create a new digital asset object
exports.createDigitalAsset = async function(networkObj, assetName, digitalAssetFileType, digitalAssetFileBuffer, createdBy) {
    try {
        //Step 1: Get Hash
        let assetHash = await this.getHashFromAsset(digitalAssetFileBuffer);
        console.log('Transaction getHashFromAsset has been submitted.');

        //Step 2: verify that asset doesn't exist
        let existingAsset = await networkObj.contract.submitTransaction('queryDigitalAssetByHash', assetHash);

        let response = {};
        if (JSON.parse(existingAsset).length > 0) {
            response.err = 'This asset already exists in the system.';
            response.existingAsset = JSON.parse(existingAsset)[0].Record;
            console.error(response.err);
            console.error(response.existingAsset);
            return response;
        }

        console.log('No other asset with this asset\'s hash was found.');

        //Step 3: generate an assetId
        let assetId = uuidv1();
        console.log(`Asset Id ${assetId} was generated.`);

        //Step 4: Upload object to COS and obtain it's link.
        // response = await this.putObject(assetId, digitalAssetFileBuffer, digitalAssetFileType);
        // if (response.err) {
        //     return response;
        // }

        // Step 4: Update blockchain
        let endorsingPeers = [];
        endorsingPeers.push(networkObj.channel.getChannelPeer(peerAddr));
        endorsingPeers.push(networkObj.channel.getChannelPeer('peer0.org2.example.com:9051'));
        const transaction = networkObj.contract.createTransaction('createDigitalAsset').setEndorsingPeers(endorsingPeers);
        response = await transaction.submit(assetId, assetName, assetHash, createdBy)
        await networkObj.gateway.disconnect();

        return response;
    } catch (error) {
        console.error(`Failed to submit transaction: ${error}`);
        return error;
    }
};

//get list of all pending asset modification requetss for assets owned by emailAddress.
exports.viewAssetModificationRequests = async function(networkObj, emailAddress) {
    try {
        let response = await networkObj.contract.evaluateTransaction('queryAllPendingModificationRequests', emailAddress);
        console.log('Transaction queryAllPendingModificationRequests has been submitted');

        await networkObj.gateway.disconnect();

        return response;
    } catch (error) {
        console.error(`Failed to submit transaction: ${error}`);
        return error;
    }
};

//update an existing digital asset
exports.updateDigitalAsset = async function(networkObj, assetId, digitalAssetFileType, digitalAssetFileBuffer, modifiedBy) {
    try {
        //Step1: Get Hash and verify that the asset hasn't already been uploaded.
        let assetHash = await this.getHashFromAsset(digitalAssetFileBuffer);
        console.log('Transaction getHashFromAsset has been submitted');

        let existingAsset = await networkObj.contract.submitTransaction('queryDigitalAssetByHash', assetHash);
        let response = {};
        if (JSON.parse(existingAsset).length > 0) {
            response.err = 'This asset already exists in the system - assetId: ' + JSON.parse(existingAsset)[0].Record.assetId;
            console.error(response.err);
            return JSON.stringify(response);
        }
        console.log('No other asset with this asset\'s hash was found.');

        //Step 2: verify if modifier is owner/in the list of approved modifiers.
        response = await networkObj.contract.submitTransaction('readDigitalAsset', assetId);
        let JSONResponse = JSON.parse(response).data;
        let assetName = JSONResponse.assetName;
        if (modifiedBy === JSONResponse.assetOwner || (JSONResponse.approvedUsers && JSONResponse.approvedUsers.includes(modifiedBy))) {
            //can directly update existing file.
            //Upload object to COS and obtain it's link.
            console.log('Case 1 - modifier is owner or approved user.');
            response = await this.putObject(assetId, digitalAssetFileBuffer, digitalAssetFileType);

            // Step 4: Update blockchain
            response = await networkObj.contract.submitTransaction('updateDigitalAsset', assetId, assetHash, modifiedBy);
            //send email to asset owner
            networkObj.event_hub.connect(true);
            let regid = networkObj.event_hub.registerChaincodeEvent(smartContractName, 'UpdateDigitalAssetEvent-' + assetId, function(event) {
                console.log(`Inside event hub code - The Digital Asset ${assetId} was successfully updated.`);
            });
        } else {
            console.log('Case 2 - modifier is not an approved user.');
            //not an already approved user
            //upload file to COS with a different name i.e. <name>_<timestamp>.ext

            let ext = path.extname(assetName);
            let temp_assetName = assetName.substring(0, assetName.indexOf(ext)) + '_' + new Date().getTime() + ext;
        
            response = await networkObj.contract.submitTransaction('addPendingModificationToDigitalAsset', assetId, temp_assetName, assetHash, modifiedBy);
            console.log('added pending modification to asset');
        }

        await networkObj.gateway.disconnect();

        //display a dialog box that indicates that the modification is pending approval
        return response;
    } catch (error) {
        console.error(`Failed to submit transaction: ${error}`);
        return error;
    }
};

//change the ownership of an existing asset
exports.changeOwnershipOfAsset = async function(networkObj, assetId, assetModifier, newAssetOwner) {
    try {
        //Step 1: Update blockchain
        let response = await networkObj.contract.submitTransaction('changeOwnershipOfAsset', assetId, assetModifier, newAssetOwner);
        //if successful, send email to previous and new owners.
        if ('data' in JSON.parse(response)) {
            console.log(`Inside event hub code - The owner of Digital Asset ${assetId} was successfully updated.`);
        }

        await networkObj.gateway.disconnect();
        return response;
    } catch (error) {
        console.error(`Failed to submit transaction: ${error}`);
        return error;
    }
};

//process an asset modification request
exports.processAssetModRequest = async function(networkObj, assetId, assetModId, emailAddress, approve, addApprovedUser) {
    try {
        //Step 1: Get the modificationPendingApproval
        let response = await networkObj.contract.submitTransaction('getModificationPendingApprovalFromAsset', assetId, assetModId);
        if ('err' in JSON.parse(response)) {
            // no modification pending approval found.
            console.error(JSON.parse(response).err);
        } else {
            //modification pending approval was found
            let modificationPendingApproval = JSON.parse(response).data;

            //Step 2: Add modifier to approvedUsers
            if (addApprovedUser) {
                await networkObj.contract.submitTransaction('addApprovedModifierToDigitalAsset', assetId, modificationPendingApproval.lastModifiedBy);
            }

            let approvalSuccess = false;
            if (approve) {
                //Step 3: Move in COS
            
            } else {
                //Step 3: Delete in COS
                
            }
            //Step 5: Delete modification from list of pending mods
            if (!approve || (approve && approvalSuccess)) {
                //either no update was needed, or update was needed and was successful
                response = await networkObj.contract.submitTransaction('deleteModificationPendingApprovalFromAsset', assetId, assetModId);
                if ('data' in JSON.parse(response)) {
                    //Step 6: Once all the transactions are complete and event notification is received - send an email to both the users.
                    console.log("+++++++++++++Complete+++++++++++++++++");
                };
            }
        }

        await networkObj.gateway.disconnect();
        return response;
    } catch (error) {
        console.error(`Failed to submit transaction: ${error}`);
        return error;
    }
};

//delete a digital asset
exports.deleteDigitalAsset = async function(networkObj, assetId, assetDeleter) {
    try {
        //Step 1: Get all pending modifications and delete them from COS
        let response = await networkObj.contract.submitTransaction('readDigitalAsset', assetId);
        let JSONResponse = JSON.parse(response).data;
        let modificationsPendingApproval = JSONResponse.modificationsPendingApproval;
        let index = null;
        for (index in modificationsPendingApproval) {
            console.log('Deleting ' + modificationsPendingApproval[index].modFileName + 'from COS.');
            let COS_response = await this.deleteObject(modificationsPendingApproval[index].modFileName);
            if (COS_response.err) {
                console.error(COS_response.err);
            }
        }
        console.log('Deleted all pending modifications for asset ' + assetId);

        //Step 2: Delete from ledger
        response = await networkObj.contract.submitTransaction('deleteDigitalAsset', assetId, assetDeleter);
        if (response.err) {
            console.error(response.err);
            return response;
        }
        await networkObj.gateway.disconnect();

        // Step 3: Delete from Cection_org1
        return response;
    } catch (error) {
        console.error(`Failed to submit transaction: ${error}`);
        return error;
    }
};

exports.downloadDigitalAssetFile = async function(assetId, assetName) {
    let data = {};
    try {
        data = await this.downloadFile(assetId, assetName);
        // console.log(`Data ${JSON.stringify(data)}`);
        return data;
    } catch (e) {
        console.log(e);
    }
    // console.log(`downloadDigitalAssetFile ==>> ${JSON.stringify(data)}`);
    return;
};

exports.getHistoryForDigitalAsset = async function(assetId) {
    let response = {};
    if (!assetId) {
        console.error('Error - no assetId found');
        response.err = 'Error - no assetId found';
    } else {
        let networkObj = await this.connectToNetwork(appAdmin);
        response = await networkObj.contract.submitTransaction('getHistoryForDigitalAsset', assetId);
    }
    return response;
};

exports.registerUser = async function(emailAddress, firstName, lastName) {

    console.log("========================================================")
    console.log("Registering new user: " + emailAddress);

    if (!emailAddress || !firstName || !lastName) {
        let response = {};
        response.err = 'Error! You need to fill all fields before you can register!';
        return response;
    }

    try {

        // Create a new file system based wallet for managing identities.
        const walletPath = path.join(walletPathPrefix);
        const wallet = new FileSystemWallet(walletPath);
        console.log(`Wallet path: ${walletPath}`);

        // Check to see if we've already enrolled the user.
        const userExists = await wallet.exists(emailAddress);
        if (userExists) {
            let response = {};
            console.error(`An identity for the user ${emailAddress} already exists in the wallet`);
            response.err = `Error! An identity for the user ${emailAddress} already exists in the wallet.`;
            return response;
        }

        // Check to see if we've already enrolled the admin user.
        const adminExists = await wallet.exists(appAdmin);
        if (!adminExists) {
            console.error(`An identity for the admin user ${appAdmin} does not exist in the wallet`);
            console.log('Run the enrollAdmin.js application before retrying');
            let response = {};
            response.err = `An identity for the admin user ${appAdmin} does not exist in the wallet. 
              Run the enrollAdmin.js application before retrying`;
            return response;
        }

        // Create a new gateway for connecting to our peer node.
        const gateway = new Gateway();
        await gateway.connect(ccp, { wallet, identity: appAdmin, discovery: gatewayDiscovery });

        // Get the CA client object from the gateway for interacting with the CA.
        const ca = gateway.getClient().getCertificateAuthority();
        const adminIdentity = gateway.getCurrentIdentity();

        // Register the user, enroll the user, and import the new identity into the wallet.
        const secret = await ca.register({ enrollmentID: emailAddress, role: 'client' }, adminIdentity);

        const enrollment = await ca.enroll({ enrollmentID: emailAddress, enrollmentSecret: secret });
        const userIdentity = await X509WalletMixin.createIdentity(orgMSPID, enrollment.certificate, enrollment.key.toBytes());
        await wallet.import(emailAddress, userIdentity);
        console.log("+++++++++++++++++++++++++++++++++++++++++++")
        console.log(`[SUCCESS] Successfully registered user ${firstName} ${lastName}. Use userName ${emailAddress} to login above.`);
        let response = `Successfully registered user ${firstName} ${lastName}. Use userName ${emailAddress} to login above.`;
        return response;
    } catch (error) {
        console.log("-------------------------------------------------")
        console.error(`[ERROR] Failed to register user + ${emailAddress} + : ${error}`);
        let response = {};
        response.err = error;
        return response;
    }
};