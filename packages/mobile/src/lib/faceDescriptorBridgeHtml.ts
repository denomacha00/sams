import { FACE_API_MODELS_URI, FACE_API_SCRIPT_URI } from '../constants/faceApi';

/** Inline WebView page: loads face-api.js and extracts 128-d descriptors from base64 JPEGs. */
export function buildFaceDescriptorBridgeHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="${FACE_API_SCRIPT_URI}"></script>
</head>
<body>
<script>
  const MODELS_URI = ${JSON.stringify(FACE_API_MODELS_URI)};
  let modelsReady = false;

  function post(obj) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  }

  async function ensureModels() {
    if (modelsReady) return;
    if (!window.faceapi) throw new Error('face-api not loaded');
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URI),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URI),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URI),
    ]);
    modelsReady = true;
    post({ type: 'ready' });
  }

  window.__extractDescriptor = async function(dataUri, requestId) {
    try {
      await ensureModels();
      const img = await faceapi.fetchImage(dataUri);
      const detection = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!detection) {
        post({ type: 'error', requestId, message: 'No face detected' });
        return;
      }
      const descriptor = Array.from(detection.descriptor);
      post({ type: 'descriptor', requestId, descriptor });
    } catch (e) {
      post({ type: 'error', requestId, message: e && e.message ? e.message : 'Face extraction failed' });
    }
  };

  (async function init() {
    try {
      if (!window.faceapi) {
        post({ type: 'error', requestId: 'init', message: 'face-api script failed to load' });
        return;
      }
      await ensureModels();
    } catch (e) {
      post({ type: 'error', requestId: 'init', message: e && e.message ? e.message : 'Model load failed' });
    }
  })();
</script>
</body>
</html>`;
}
