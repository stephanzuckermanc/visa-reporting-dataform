# Independent deploy of the Dataform repository.
#
# Why this script uses the REST API instead of `gcloud dataform ...`:
#   The `dataform` surface is not bundled in the default gcloud install on
#   Windows (running it errors with "Invalid choice: 'dataform'"). Asking the
#   operator to `gcloud components install ...` adds a step that fails on
#   managed/enterprise gcloud installs. The REST API is always available.
#
# What this script does:
#   1. Verifies the GitHub PAT secret exists (created manually -- see DEPLOY.md 2c).
#   2. Grants the Dataform service agent read access to that secret (idempotent).
#   3. Creates the Dataform repository with gitRemoteSettings pointing to GitHub.
#      A repo created WITHOUT gitRemoteSettings cannot be compiled by
#      gitCommitish -- that was the original failure mode here.
#   4. Triggers a first compilation result against the default branch and prints
#      any compilation errors before returning success.
#
# Run from this directory:  cd dataform ; .\deploy.ps1
$ErrorActionPreference = "Continue"

$PROJECT_ID  = if ($env:PROJECT_ID)            { $env:PROJECT_ID }            else { "visa-reporting" }
$LOCATION    = if ($env:LOCATION)              { $env:LOCATION }              else { "us-central1" }
$REPO        = "visa-hootsuite"
$GIT_URL     = if ($env:DATAFORM_GIT_URL)      { $env:DATAFORM_GIT_URL }      else { "https://github.com/stephanzuckermanc/visa-reporting-dataform.git" }
$GIT_BRANCH  = if ($env:DATAFORM_GIT_BRANCH)   { $env:DATAFORM_GIT_BRANCH }   else { "main" }
$PAT_SECRET  = if ($env:DATAFORM_PAT_SECRET)   { $env:DATAFORM_PAT_SECRET }   else { "dataform-github-pat" }

# --- Resolve project number for the Dataform service agent grant ---
$PROJECT_NUMBER = (gcloud projects describe $PROJECT_ID --format='value(projectNumber)') | Out-String
$PROJECT_NUMBER = $PROJECT_NUMBER.Trim()
if ($LASTEXITCODE -ne 0 -or -not $PROJECT_NUMBER) {
  Write-Error "[FAIL] Could not resolve project number for $PROJECT_ID."
  exit 1
}
$DATAFORM_SA = "service-$PROJECT_NUMBER@gcp-sa-dataform.iam.gserviceaccount.com"

# --- Ensure the Dataform Service Agent exists ---
# GCP creates service agents lazily. On a brand-new project the SA
# `service-<num>@gcp-sa-dataform.iam.gserviceaccount.com` does not exist until
# something forces its creation. If we try to grant it secretmanager.secretAccessor
# before it exists, gcloud returns "Service account does not exist" and silently
# leaves no binding -> the next compilationResults call fails with
# FAILED_PRECONDITION: Unable to fetch Git token secret.
Write-Host "Ensuring Dataform Service Agent ($DATAFORM_SA) is provisioned..."
gcloud beta services identity create --service=dataform.googleapis.com --project=$PROJECT_ID | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "[FAIL] Could not create/verify the Dataform Service Agent. Run 'gcloud components install beta' if the beta surface is missing, then re-run."
  exit 1
}

# --- Verify PAT secret exists ---
$null = gcloud secrets describe $PAT_SECRET --project=$PROJECT_ID 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Error "[FAIL] Secret '$PAT_SECRET' does not exist in project $PROJECT_ID."
  Write-Host ""
  Write-Host "Create it once (see docs/DEPLOY.md section 2c for the GitHub PAT recipe):"
  Write-Host "  `$pat = '<your GitHub PAT with `repo` scope>'"
  Write-Host "  `$tmp = [IO.Path]::GetTempFileName()"
  Write-Host "  [IO.File]::WriteAllText(`$tmp, `$pat)"
  Write-Host "  gcloud secrets create $PAT_SECRET --data-file=`$tmp --project=$PROJECT_ID"
  Write-Host "  Remove-Item `$tmp"
  exit 1
}

# --- Grant Dataform service agent access to the PAT secret (idempotent) ---
# This binding is on the SECRET, not the project, so it's surgical and safe.
# Without it, Dataform fails with PERMISSION_DENIED when fetching from GitHub.
# We assert on $LASTEXITCODE because previously this command failed silently
# (Out-Null hid the error) when the SA didn't exist yet.
Write-Host "Granting roles/secretmanager.secretAccessor on $PAT_SECRET to $DATAFORM_SA..."
gcloud secrets add-iam-policy-binding $PAT_SECRET `
  --member="serviceAccount:$DATAFORM_SA" `
  --role="roles/secretmanager.secretAccessor" `
  --project=$PROJECT_ID `
  --condition=None | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "[FAIL] Could not grant secretAccessor to $DATAFORM_SA. The Dataform Service Agent may still be propagating. Wait 60 s and re-run. If it persists, manually verify the SA exists with: gcloud iam service-accounts describe $DATAFORM_SA --project=$PROJECT_ID"
  exit 1
}

# --- Resolve latest enabled version of the PAT secret ---
$PAT_VERSION = (gcloud secrets versions list $PAT_SECRET --project=$PROJECT_ID --filter="state=ENABLED" --sort-by=~createTime --limit=1 --format='value(name)') | Out-String
$PAT_VERSION = $PAT_VERSION.Trim()
if (-not $PAT_VERSION) {
  Write-Error "[FAIL] No ENABLED versions found for secret $PAT_SECRET."
  exit 1
}
$PAT_VERSION_RESOURCE = "projects/$PROJECT_ID/secrets/$PAT_SECRET/versions/$PAT_VERSION"
Write-Host "Using PAT secret version: $PAT_VERSION_RESOURCE"

# --- REST API setup ---
$accessToken = (gcloud auth print-access-token) | Out-String
$accessToken = $accessToken.Trim()
$baseUrl = "https://dataform.googleapis.com/v1beta1/projects/$PROJECT_ID/locations/$LOCATION/repositories"
$headers = @{ Authorization = "Bearer $accessToken"; "Content-Type" = "application/json" }

# --- Check repo existence ---
$repoExists = $false
$existingRemote = $null
try {
  $existing = Invoke-RestMethod -Method Get -Uri "$baseUrl/$REPO" -Headers $headers -ErrorAction Stop
  $repoExists = $true
  $existingRemote = $existing.gitRemoteSettings
} catch {
  $sc = $_.Exception.Response.StatusCode.value__
  if ($sc -ne 404) {
    Write-Error "[FAIL] Unexpected error checking repo: HTTP $sc -- $($_.Exception.Message)"
    exit 1
  }
}

if ($repoExists) {
  if (-not $existingRemote -or -not $existingRemote.url) {
    Write-Error "[FAIL] Repo '$REPO' exists but has no gitRemoteSettings. compilation-results --git-commitish=$GIT_BRANCH will return 404. Delete the repo and re-run (irreversible):  gcloud dataform repositories delete $REPO --region=$LOCATION --project=$PROJECT_ID"
    exit 1
  }
  Write-Host "Repo '$REPO' already exists:"
  Write-Host "  url=$($existingRemote.url)"
  Write-Host "  defaultBranch=$($existingRemote.defaultBranch)"
} else {
  Write-Host "Repo '$REPO' not found - creating with gitRemoteSettings..."
  $createBody = @{
    gitRemoteSettings = @{
      url = $GIT_URL
      defaultBranch = $GIT_BRANCH
      authenticationTokenSecretVersion = $PAT_VERSION_RESOURCE
    }
  } | ConvertTo-Json -Depth 5
  try {
    $created = Invoke-RestMethod -Method Post -Uri "$($baseUrl)?repositoryId=$REPO" -Headers $headers -Body $createBody -ErrorAction Stop
    Write-Host "Created: $($created.name)"
  } catch {
    $sc = $_.Exception.Response.StatusCode.value__
    # Read response body for the real error message (gcloud errors are usually here, not in Exception.Message).
    $errBody = ""
    try { $errBody = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
    Write-Error "[FAIL] Repo create returned HTTP $sc. Body: $errBody"
    exit 1
  }
}

# --- Trigger first compilation, with retry for IAM propagation ---
# Right after we grant secretAccessor to the Dataform service agent, GCP IAM
# typically needs 30-60s to propagate. During that window the compilation
# call returns:
#   HTTP 400 FAILED_PRECONDITION  "Unable to fetch Git token secret"
# This is NOT a config error -- it's an eventual-consistency artifact. Retry
# a handful of times with backoff before declaring real failure.
Write-Host "`nTriggering compilation against branch '$GIT_BRANCH'..."
$compBody = @{ gitCommitish = $GIT_BRANCH } | ConvertTo-Json
$maxAttempts = 5
$comp = $null
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  try {
    $comp = Invoke-RestMethod -Method Post -Uri "$baseUrl/$REPO/compilationResults" -Headers $headers -Body $compBody -ErrorAction Stop
    break
  } catch {
    $sc = $_.Exception.Response.StatusCode.value__
    $errBody = ""
    try { $errBody = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
    # Only retry on the specific IAM propagation symptom. Other
    # FAILED_PRECONDITION variants (invalid workflow_settings.yaml, compilation
    # errors, etc.) are deterministic -- retrying just wastes time and confuses
    # the operator with 5 identical attempts.
    $isIamPropagation = ($sc -eq 400) -and ($errBody -match "Unable to fetch Git token secret")
    if ($isIamPropagation -and $attempt -lt $maxAttempts) {
      $delay = [Math]::Min(60, 10 * [Math]::Pow(2, $attempt - 1))
      Write-Host "  Attempt ${attempt}/${maxAttempts}: IAM not propagated yet (HTTP $sc). Retrying in ${delay}s..."
      Start-Sleep -Seconds $delay
      continue
    }
    Write-Error "[FAIL] compilationResults create returned HTTP $sc (attempt $attempt/$maxAttempts). Body: $errBody"
    exit 1
  }
}
Write-Host "Compilation result: $($comp.name)"

# --- Inspect compilation errors (compilation can succeed-the-call but contain SQL errors) ---
if ($comp.compilationErrors -and $comp.compilationErrors.Count -gt 0) {
  Write-Warning "Compilation reported $($comp.compilationErrors.Count) error(s):"
  $comp.compilationErrors | ForEach-Object {
    Write-Host "  [$($_.actionTarget.name)] $($_.message)"
  }
  exit 1
}

Write-Host "`n[OK] Dataform repo linked to GitHub and first compilation succeeded."
Write-Host "     The workflow's compile_dataform step should now pass."
