#!/usr/bin/env bash
# Independent deploy of the Dataform repository.
# Creates the repo if missing, then triggers a workflow invocation against main.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-visa-reporting}"
LOCATION="${LOCATION:-us-central1}"
REPO="visa-hootsuite"

gcloud dataform repositories describe "${REPO}" \
  --project="${PROJECT_ID}" --region="${LOCATION}" >/dev/null 2>&1 || \
  gcloud dataform repositories create "${REPO}" \
    --project="${PROJECT_ID}" --region="${LOCATION}"

# Compile and run against main. Requires the Dataform repo to be linked to a git remote
# OR for local files to be uploaded via the Dataform UI / API.
gcloud dataform compilation-results create \
  --project="${PROJECT_ID}" --region="${LOCATION}" \
  --repository="${REPO}" \
  --git-commitish=main
