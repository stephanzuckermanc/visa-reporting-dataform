# Independent deploy of the Dataform repository.
# Creates the repo if missing, then triggers a compilation against main.
# Run from this directory: cd dataform ; .\deploy.ps1
$ErrorActionPreference = "Continue"  # gcloud writes info to stderr; let exit codes decide success

$PROJECT_ID = if ($env:PROJECT_ID) { $env:PROJECT_ID } else { "visa-reporting" }
$LOCATION = if ($env:LOCATION) { $env:LOCATION } else { "us-central1" }
$REPO = "visa-hootsuite"

Write-Host "Checking Dataform repository $REPO..."
$null = gcloud dataform repositories describe $REPO --project=$PROJECT_ID --region=$LOCATION 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "Repo not found - creating..."
  gcloud dataform repositories create $REPO --project=$PROJECT_ID --region=$LOCATION
}

Write-Host "Triggering compilation against main..."
gcloud dataform compilation-results create `
  --project=$PROJECT_ID `
  --region=$LOCATION `
  --repository=$REPO `
  --git-commitish=main

Write-Host "`n[OK] Dataform compilation triggered. Verify in Cloud Console > Dataform > $REPO."
