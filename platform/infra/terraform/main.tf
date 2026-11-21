# AI Voice Interview Platform on AWS Mumbai (ap-south-1). One definition, two environments:
#   terraform init -backend-config=environments/<env>.backend.hcl
#   terraform apply -var-file=environments/<env>.tfvars
# Audio, transcripts and the database stay in ap-south-1 (DPDP: stated in the candidate notice).

terraform {
  required_version = ">= 1.10" # S3 native state locking
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.71" }
    random  = { source = "hashicorp/random", version = "~> 3.9" }
    archive = { source = "hashicorp/archive", version = "~> 2.8" }
  }
  # State in S3 with locking; bucket/key come from environments/<env>.backend.hcl.
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "ai-voice-interview", Environment = var.env, ManagedBy = "terraform" }
  }
}

locals {
  name       = "interview-${var.env}"
  production = var.env == "production"
  azs        = slice(data.aws_availability_zones.available.names, 0, 2)
}

data "aws_availability_zones" "available" { state = "available" }
data "aws_caller_identity" "current" {}
