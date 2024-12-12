# REST APIs
<img src="https://github.com/SustainWise/.github/blob/main/profile/assets/Logo%20SustainWise.jpg" alt="Logo" width="200">

## Tools
   - Google Cloud Platform
   - Node js version v18.20.4
   - Firebase
   - Postman

## Set Up for CC Team
Creating the Sustain Wise Backend API App

1. Create Project and Firestore:
   - Go to the Firebase console.
   - Create a new project.
   - Set up Firestore in the project.

2. Install Firebase:
   - Use firebase init and firebase login in the local folder.

3. Integrate Firebase:
   - Utilize firebase-admin and firebase-functions for API integration and use ADC to connect to Firebase.

4. Deploy the Backend API:
   - Deploy the Backend API to Cloud Run Functions.

5. Configure Function:
   - Create a Function and choose HTTPS trigger.
   - Allocate memory: 256 MiB, 0.167 CPU, Timeout: 60s.
   - Maximum concurrent requests per instance: 1.
   - Maximum number of instances: 50.
   - Select the region: asia-southeast2.

6. Write and Deploy Code:
   - Write code in the inline editor.
   - Select Node.js18 runtime and click deploy.

7. Create Cloud Storage:
   - Create Cloud Storage to upload the tf.lite model.
   - Why we use TensorFlow Lite because the model it only analyzes a user's financial data over a month to provide tips and recommendations. So TFLite model is       an ideal choice for  ensuring faster performance and lower latency. Storing it in Cloud Storage allows easy access for the mobile application while keeping      deployment and maintenance costs low.
     
8. Create Project Architecture
   
10. Create Github Organization
   - Add readme to the github organization for project documentation
   - add 3 repositories, 1 for CC, 1 for MD, and 1 for ML


## Link BackEnd API with Cloud Run Function
https://sustainwise-1041878630324.asia-southeast2.run.app

## API Documentaion
https://documenter.getpostman.com/view/36349178/2sAYHwL5qo

## Cloud Architecture

<img src="https://github.com/SustainWise/.github/blob/main/profile/assets/sustainwise-cloud-architecture.jpg" alt="Cloud Architecture" width="1000">


