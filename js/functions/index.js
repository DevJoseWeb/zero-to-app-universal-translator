// Copyright 2018 Google Inc.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

// Firebase
const admin = require('firebase-admin');
//admin.initializeApp(functions.config().firebase);

// Cloud Vision
const vision = require('@google-cloud/vision');
const visionClient =  new vision.ImageAnnotatorClient();
const bucketName = 'tesla-369.appspot.com';

// Translate
const functions = require('firebase-functions');
const Speech = require('@google-cloud/speech');
const speech = Speech({keyFilename: "service-account-credentials.json"});
const Translate = require('@google-cloud/translate');
const translate = Translate({keyFilename: "service-account-credentials.json"});
const Encoding = Speech.v1.types.RecognitionConfig.AudioEncoding;
const Firestore = require('@google-cloud/firestore');
const getLanguageWithoutLocale = require("./utils").getLanguageWithoutLocale;

// Firestore
const db = new Firestore();

//OCR Image to text
exports.tesla369OCRImagem = functions.storage.bucket(bucketName).object().onChange( async event => {

    if (event.data.resourceState == 'not_exists') return false;

    const object = event.data;
    const filePath = object.name;   

    const imageUri = `gs://${bucketName}/${filePath}`;

    const docId = filePath.split('.jpg')[0];

    const docRef  = admin.firestore().collection('photos').doc(docId);
    //se entrar entrar png não faz nada
    if (filePath.endsWith('.png')) return false;
    //se entrar pdf não faz nada
    if (!filePath.endsWith('.pdf')) return false;

    // Text Extraction
    const textRequest = await visionClient.documentTextDetection(imageUri)
    const fullText = textRequest[0].textAnnotations[0]
    const text =  fullText ? fullText.description : null

    // Web Detection
    const webRequest = await visionClient.webDetection(imageUri)
    const web = webRequest[0].webDetection

    // Faces    
    const facesRequest = await visionClient.faceDetection(imageUri)
    const faces = facesRequest[0].faceAnnotations

    // Landmarks
    const landmarksRequest = await visionClient.landmarkDetection(imageUri)
    const landmarks = landmarksRequest[0].landmarkAnnotations
    
    // Save to Firestore
    const data = { text, web, faces, landmarks }
    return docRef.set(data)

});

exports.onUploadFS = functions.firestore.document("/uploads/{uploadId}").onWrite((event) => {
        let data = event.data.data();
        let language = data.language ? data.language : "en";
        let sampleRate = data.sampleRate ? parseInt(data.sampleRate, 10) : 16000;
        let encoding = data.encoding == "FLAC" ? Encoding.FLAC : Encoding.LINEAR16;

        const request = {
            config: {
                languageCode,
                sampleRateHertz,
                encoding
            },
            //audio: { uri : `gs://${process.env.GCP_PROJECT}.appspot.com/${data.fullPath}` }
            //audio: { uri : `gs://tesla-369.appspot.com/${data.fullPath}` }
            audio: { uri : `gs://${bucketName}.appspot.com/${data.fullPath}` }
        };

        return speech.recognize(request).then((response) => {
            let transcript = response[0].results[0].alternatives[0].transcript;
            return db.collection("transcripts").doc(event.params.uploadId).set({text: transcript, language: language});
        });
    });

exports.onTranscriptFS = functions.firestore
    .document("/transcripts/{transcriptId}")
    .onWrite((event) => {
        let value = event.data.data();
        let transcriptId = event.params.transcriptId;
        let text = value.text ? value.text : value;

        const languages = ["en", "es", "pt", "de", "ja", "hi", "nl", "fr", "pl"];

        const from = value.language ? getLanguageWithoutLocale(value.language) : "en";

          let promises = languages.map(to => {
            if (from == to) {
                return db.collection("translations").doc(transcriptId).set({to: {text: text, language: from}}, {merge: true});
            } else {
                // Call the Google Cloud Platform Translate API
                return translate.translate(text, {
                    from,
                    to
                }).then(result => {
                    // Write the translation to the database
                    let translation = result[0];
                    return db.collection("translations").doc(transcriptId).set({to: {text: translation, language: to}}, {merge: true});
                });
            }
        });
        return Promise.all(promises).then(() => {
            return db.collection("translations").doc(transcriptId).set(doc);
        });
    });
