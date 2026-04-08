# AWS Setup Guide: Capita Edgex Backend

This guide outlines the steps to manually set up the AWS resources required for the automated deployment of your backend.

## 1. Create an ECR Private Repository
1.  Log in to the **AWS Console**.
2.  Search for **Elastic Container Registry (ECR)**.
3.  Click **Create repository**.
4.  Set visibility to **Private**.
5.  Name it (e.g., `capita-edgex-backend`).
6.  Click **Create repository**.
7.  **Note down the Repository URI** (you'll need this for GitHub Secrets).

## 2. Create an IAM User for GitHub Actions
1.  Search for **IAM** in the AWS Console.
2.  Go to **Users** > **Create user**.
3.  Name it `github-actions-deploy`.
4.  Attach the following policies directly:
    - `AmazonEC2ContainerRegistryFullAccess`
    - `AWSAppRunnerFullAccess`
5.  After creation, go to the user's **Security credentials** tab.
6.  Click **Create access key**.
7.  Select **Third-party service** (GitHub Actions).
8.  **Note down the Access Key ID and Secret Access Key**.

## 3. Create an App Runner Service
1.  Search for **AWS App Runner**.
2.  Click **Create service**.
3.  **Source and deployment**:
    - Repository type: **Container registry**.
    - Provider: **Amazon ECR**.
    - Container image URI: Click **Browse** and select your image (pushing it once via CLI or waiting for the workflow is fine, but for the first setup, you might need an image there).
    - Deployment settings: **Manual** (or Automatic if you prefer AWS to handle it, but our GitHub Action will trigger it).
4.  **Service configuration**:
    - Service name: `capita-edgex-backend`.
    - Virtual CPU & Memory: `1 vCPU`, `2 GB` (Standard).
    - **Environment Variables**: Add all variables from your `.env` (DATABASE_URL, GEMINI_API_KEY, etc.).
    - Port: `3000`.
5.  **Review and create**.

## 4. Configure GitHub Secrets
In your GitHub repository, go to **Settings** > **Secrets and variables** > **Actions** and add:
- `AWS_ACCESS_KEY_ID`: Your IAM user's Access Key ID.
- `AWS_SECRET_ACCESS_KEY`: Your IAM user's Secret Access Key.
- `AWS_REGION`: e.g., `us-east-1`.
- `ECR_REPOSITORY`: The name of your ECR repository (e.g., `capita-edgex-backend`).
- `APP_RUNNER_SERVICE_NAME`: The name of your App Runner service.
- `APP_RUNNER_ACCESS_ROLE_ARN`: The ARN of an IAM role that App Runner uses to access ECR (usually `AppRunnerECRAccessRole`).

> [!TIP]
> **To fix the "Sleep Mode" issues**: AWS App Runner keeps your service always available unless you manually delete it. It does not "sleep" like Render's free tier.
