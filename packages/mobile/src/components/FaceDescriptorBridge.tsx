import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildFaceDescriptorBridgeHtml } from '../lib/faceDescriptorBridgeHtml';

type BridgeMessage =
  | { type: 'ready' }
  | { type: 'descriptor'; requestId: string; descriptor: number[] }
  | { type: 'error'; requestId: string; message: string };

type Pending = {
  resolve: (descriptor: number[]) => void;
  reject: (err: Error) => void;
};

const BRIDGE_HTML = buildFaceDescriptorBridgeHtml();

export interface FaceDescriptorBridgeHandle {
  ready: () => boolean;
  extractFromBase64: (base64: string) => Promise<number[]>;
}

export function getFaceDescriptorBridge(): FaceDescriptorBridgeHandle | undefined {
  return (globalThis as { __samsFaceBridge?: FaceDescriptorBridgeHandle }).__samsFaceBridge;
}

export function FaceDescriptorBridge() {
  const webRef = useRef<WebView>(null);
  const pendingRef = useRef<Map<string, Pending>>(new Map());
  const [ready, setReady] = useState(false);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(event.nativeEvent.data) as BridgeMessage;
    } catch {
      return;
    }

    if (msg.type === 'ready') {
      setReady(true);
      return;
    }

    const pending = pendingRef.current.get(msg.requestId);
    if (!pending) return;
    pendingRef.current.delete(msg.requestId);

    if (msg.type === 'descriptor') {
      pending.resolve(msg.descriptor);
    } else {
      pending.reject(new Error(msg.message || 'Face extraction failed'));
    }
  }, []);

  useEffect(() => {
    (globalThis as { __samsFaceBridge?: FaceDescriptorBridgeHandle }).__samsFaceBridge = {
      ready: () => ready,
      extractFromBase64: (base64: string) => {
        const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const dataUri = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;

        return new Promise<number[]>((resolve, reject) => {
          if (!ready || !webRef.current) {
            reject(new Error('Face models still loading. Wait a moment and try again.'));
            return;
          }
          pendingRef.current.set(requestId, { resolve, reject });
          const escaped = dataUri.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          webRef.current.injectJavaScript(
            `window.__extractDescriptor('${escaped}','${requestId}'); true;`,
          );
          setTimeout(() => {
            if (pendingRef.current.has(requestId)) {
              pendingRef.current.delete(requestId);
              reject(new Error('Face scan timed out. Try again.'));
            }
          }, 45000);
        });
      },
    };
    return () => {
      delete (globalThis as { __samsFaceBridge?: FaceDescriptorBridgeHandle }).__samsFaceBridge;
    };
  }, [ready]);

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html: BRIDGE_HTML }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -9999,
  },
});
