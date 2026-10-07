# Deploying dummy-project to GCP

This guide deploys the dashboard as a static site with
**Cloud Build → GCS bucket → Global external Application Load Balancer + Cloud CDN**.

```
GitHub push ─▶ Cloud Build ─▶ GCS bucket ◀─ Backend bucket (+ Cloud CDN)
                                                  ▲
User ─▶ http(s)://<static IP / domain> ─▶ Forwarding rule ─▶ Proxy ─▶ URL map
```

You deploy by hand first (Steps 1–4) to see each piece working, then automate it (Step 5). HTTPS with a domain (Step 6) is optional.

> **Cost:** the LB forwarding rule costs about $18/month from Step 3 onwards. Tear everything down (Step 8) when you're not using it.

---

## Step 0: Shell variables (run in every new terminal)

```bash
export PROJECT_ID=$(gcloud config get-value project)
export REGION=asia-south1
export BUCKET=${PROJECT_ID}-dummy-web
export LB_IP=$(gcloud compute addresses describe dummy-web-ip --global --format="value(address)" 2>/dev/null)
export SA=cloudbuild-deployer@$PROJECT_ID.iam.gserviceaccount.com
echo "$PROJECT_ID  $BUCKET  $LB_IP"
```

Bucket names are unique across all of GCP, so the project ID is used as a prefix. `LB_IP` stays empty until Step 3a.

---

## Step 1: Create the bucket (GCS)

```bash
gcloud storage buckets create gs://$BUCKET \
  --location=$REGION \
  --uniform-bucket-level-access \
  --no-public-access-prevention

# Anyone can read files (but not list the bucket)
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=allUsers --role=roles/storage.objectViewer

# "/" serves index.html, and unknown paths also get index.html
gcloud storage buckets update gs://$BUCKET \
  --web-main-page-suffix=index.html \
  --web-error-page=index.html
```

**Check:** `gcloud storage buckets describe gs://$BUCKET` shows the `website` settings.

---

## Step 2: First upload by hand

From the repo root:

```bash
pnpm install
pnpm --filter dashboard build:production

cd apps/dashboard/dist
gcloud storage cp -r assets gs://$BUCKET/ --cache-control="public, max-age=31536000, immutable"
gcloud storage cp favicon.svg gs://$BUCKET/ --cache-control="public, max-age=3600"
gcloud storage cp index.html gs://$BUCKET/ --cache-control="no-cache"
cd -
```

- **Assets go first and `index.html` last.** Nobody ever gets an `index.html` that points at files that haven't been uploaded yet.
- **Old assets are not deleted.** Tabs that are already open still load their JS files.
- **Hashed assets are cached for a year** because their names change on every build.
- **`index.html` is set to `no-cache`,** so a new deploy shows up immediately.

**Check:**

```bash
gcloud storage ls -l "gs://$BUCKET/**"
curl -I https://storage.googleapis.com/$BUCKET/index.html   # 200
```

If you open that URL in a browser, the page is **blank**. That's expected: the app loads `/assets/...` from the domain root. The LB fixes it in the next step.

---

## Step 3: Load balancer + CDN (HTTP on a bare IP)

```bash
# 3a. Static global IP
gcloud compute addresses create dummy-web-ip --global
export LB_IP=$(gcloud compute addresses describe dummy-web-ip --global --format="value(address)")

# 3b. Backend bucket: LB → GCS, with Cloud CDN on, following our Cache-Control headers
gcloud compute backend-buckets create dummy-web-backend \
  --gcs-bucket-name=$BUCKET \
  --enable-cdn \
  --cache-mode=USE_ORIGIN_HEADERS

# 3c. URL map: routing rules (everything → the bucket)
gcloud compute url-maps create dummy-web-lb --default-backend-bucket=dummy-web-backend

# 3d. HTTP proxy
gcloud compute target-http-proxies create dummy-web-http-proxy --url-map=dummy-web-lb

# 3e. Forwarding rule: IP:80 → proxy. The LB is now live (and billing starts).
gcloud compute forwarding-rules create dummy-web-http-rule \
  --global \
  --load-balancing-scheme=EXTERNAL_MANAGED \
  --address=dummy-web-ip \
  --target-http-proxy=dummy-web-http-proxy \
  --ports=80
```

`EXTERNAL_MANAGED` is the current Global external Application LB. The older "classic" type doesn't support the custom error responses used in Step 4.

**Check** (after 3–5 minutes for the LB to roll out):

```bash
curl -I http://$LB_IP/           # 200
curl -I http://$LB_IP/users/3    # 404 status, with index.html as the body (Step 4 fixes the status)
```

Open `http://<LB_IP>` in a browser. You should see the user list and the **env: production** badge. Click a user, then refresh.

---

## Step 4: Fix deep links (404 → index.html with 200)

```bash
gcloud compute url-maps export dummy-web-lb --global --destination=url-map.yaml
```

Add this to `url-map.yaml`, replacing `PROJECT_ID`:

```yaml
defaultCustomErrorResponsePolicy:
  errorService: https://www.googleapis.com/compute/v1/projects/PROJECT_ID/global/backendBuckets/dummy-web-backend
  errorResponseRules:
    - matchResponseCodes: ["403", "404"]
      path: /index.html
      overrideResponseCode: 200
```

```bash
gcloud compute url-maps import dummy-web-lb --global --source=url-map.yaml
```

- This is the GCP version of the `rewrites` in `vercel.json`.
- 403 is included because GCS can return 403 instead of 404 for a missing file when the caller isn't allowed to list the bucket.
- `url-map.yaml` is generated from your project, so don't commit it.

**Check** (after 1–2 minutes): `curl -I http://$LB_IP/users/3` returns **200**.

---

## Step 5: Automate deploys with Cloud Build

### 5a. A service account that can only touch this bucket

```bash
gcloud iam service-accounts create cloudbuild-deployer --display-name="Deploys dummy-web to GCS"

gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:$SA --role=roles/storage.objectAdmin

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$SA --role=roles/logging.logWriter
```

### 5b. Build config

[`cloudbuild.yaml`](cloudbuild.yaml) at the repo root:

- **Step `build`** runs in `node:22`: pnpm install, then `build:${_MODE}`.
- **Step `upload`** runs in `cloud-sdk`: copies `dist/` to `gs://${_BUCKET_NAME}`. Hashed assets go first (cached 1 year), other public files next (cached 5 min), and `index.html` last (`no-cache`). Old assets are never deleted.
- **Every step shares `/workspace`,** which is how `dist/` passes from the first step to the second.

Commit and push it.

### 5c. Connect GitHub and create a trigger (Console)

1. **Cloud Build → Repositories → 2nd gen → Create host connection.**
   - Region `asia-south1`, provider GitHub.
   - Authorise the GitHub App.
   - Enable the Secret Manager API if prompted. The connection stores its GitHub token there.
2. **Link repository:** pick this repo.
3. **Cloud Build → Triggers → Create trigger:**
   - Region `asia-south1`.
   - Event: _Push to a branch_, `^main$`.
   - Configuration: `cloudbuild.yaml`.
   - Substitutions: `_BUCKET_NAME` = your bucket name (the default in `cloudbuild.yaml` is `virtual-plexus-510706-r6-frontend`), `_MODE` = `production`.
   - Service account: `cloudbuild-deployer@<project>.iam.gserviceaccount.com`.
4. Click **Run**, or push a commit.

**Check:** Cloud Build → History shows a green build. Change some text, push, and refresh `http://<LB_IP>`. The change is live with no CDN cache clearing.

> If the build sits queued, or fails with a quota error in `asia-south1`, create the connection and trigger in `us-central1` instead. The bucket can stay in Mumbai.

---

## Step 6: HTTPS + custom domain (optional)

Replace `dummy.yourdomain.com` with your domain.

```bash
# 6a. Prove you own the domain via DNS, so the cert is issued BEFORE traffic moves
gcloud certificate-manager dns-authorizations create dummy-auth --domain=dummy.yourdomain.com
gcloud certificate-manager dns-authorizations describe dummy-auth
#   → add the CNAME record it prints at your DNS provider

# 6b. Certificate + certificate map
gcloud certificate-manager certificates create dummy-cert \
  --domains=dummy.yourdomain.com --dns-authorizations=dummy-auth
gcloud certificate-manager maps create dummy-cert-map
gcloud certificate-manager maps entries create dummy-entry \
  --map=dummy-cert-map --certificates=dummy-cert --hostname=dummy.yourdomain.com
gcloud certificate-manager certificates describe dummy-cert   # wait for state: ACTIVE

# 6c. HTTPS proxy + :443 rule on the same IP
gcloud compute target-https-proxies create dummy-web-https-proxy \
  --url-map=dummy-web-lb --certificate-map=dummy-cert-map
gcloud compute forwarding-rules create dummy-web-https-rule \
  --global --load-balancing-scheme=EXTERNAL_MANAGED \
  --address=dummy-web-ip --target-https-proxy=dummy-web-https-proxy --ports=443
```

Add an **A record**: `dummy.yourdomain.com → $LB_IP`.

Redirect HTTP to HTTPS using [`redirect.yaml`](redirect.yaml):

```bash
gcloud compute url-maps import dummy-web-redirect --global --source=redirect.yaml
gcloud compute target-http-proxies update dummy-web-http-proxy --url-map=dummy-web-redirect
```

Getting the certificate ACTIVE first and switching DNS second is the zero-downtime pattern for the real flexipill switch-over.

---

## Step 7: Experiments

| Try                                                                           | What it shows                                                          |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `curl -I http://$LB_IP/assets/<file>.js` twice, then compare the `Age` header | A CDN cache hit: the second response came from Google's edge           |
| `curl -I http://$LB_IP/`                                                      | `index.html` is never cached (`no-cache`)                              |
| Set `_MODE=staging` on the trigger and run it                                 | The badge says **env: staging**, so env values are fixed at build time |
| Push a broken commit, then use History → **Rebuild** on the last good build   | How rollback works in this setup                                       |
| Network Services → Cloud CDN → Monitoring                                     | Cache hit ratio and how much data the edge served                      |

---

## Step 8: Tear down (saves credit)

Delete in this order, because each item depends on the ones before it being gone. Skip anything you didn't create.

```bash
gcloud compute forwarding-rules delete dummy-web-http-rule dummy-web-https-rule --global
gcloud compute target-https-proxies delete dummy-web-https-proxy
gcloud compute target-http-proxies delete dummy-web-http-proxy
gcloud compute url-maps delete dummy-web-redirect dummy-web-lb --global
gcloud compute backend-buckets delete dummy-web-backend
gcloud compute addresses delete dummy-web-ip --global   # a reserved IP with nothing attached still costs money
gcloud storage rm -r gs://$BUCKET
```
