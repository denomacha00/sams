import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { submitQrAttendance } from '../api/client';
import { getApiErrorMessage } from '../lib/apiError';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'ScanQR'>;

export function ScanQRScreen() {
  const navigation = useNavigation<Nav>();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'acquiring' | 'success' | 'failed'>('idle');
  const handledRef = useRef(false);

  const handleQrToken = useCallback(async (qrToken: string) => {
    if (handledRef.current || loading) return;
    handledRef.current = true;
    setScanning(false);
    setLoading(true);
    setError(null);
    setGpsStatus('acquiring');

    try {
      let gpsCoords: { lat: number; lng: number } | undefined;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          gpsCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setGpsStatus('success');
        } catch {
          setGpsStatus('failed');
        }
      } else {
        setGpsStatus('failed');
      }

      await submitQrAttendance(qrToken, gpsCoords);
      setSuccess(true);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to record attendance'));
      handledRef.current = false;
      setScanning(true);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const resetScan = () => {
    handledRef.current = false;
    setSuccess(false);
    setError(null);
    setGpsStatus('idle');
    setScanning(true);
  };

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.indigo400} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Header onBack={() => navigation.goBack()} />
        <View style={styles.card}>
          <Text style={styles.title}>Camera access needed</Text>
          <Text style={styles.hint}>
            SAMS needs your camera to scan the teacher&apos;s attendance QR code.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={requestPermission}>
            <Text style={styles.primaryBtnText}>Allow camera</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header onBack={() => navigation.goBack()} />

      <View style={styles.gpsRow}>
        <GpsPill status={gpsStatus} />
      </View>

      {success ? (
        <View style={styles.successBox}>
          <Ionicons name="checkmark-circle" size={48} color={colors.emerald400} />
          <Text style={styles.successTitle}>Attendance recorded</Text>
          <Pressable style={styles.emeraldBtn} onPress={resetScan}>
            <Text style={styles.emeraldBtnText}>Scan again</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.cameraWrap}>
            {scanning ? (
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }: { data: string }) => {
                  if (data) void handleQrToken(data);
                }}
              />
            ) : (
              <View style={[styles.camera, styles.cameraPaused]}>
                <ActivityIndicator color={colors.indigo400} size="large" />
              </View>
            )}
            <View style={styles.frameOverlay} pointerEvents="none">
              <View style={styles.cornerTL} />
              <View style={styles.cornerTR} />
              <View style={styles.cornerBL} />
              <View style={styles.cornerBR} />
            </View>
          </View>

          <Text style={styles.scanHint}>
            {loading ? 'Submitting attendance…' : 'Point at the teacher\'s QR code'}
          </Text>

          {!loading && scanning ? (
            <Pressable style={styles.secondaryBtn} onPress={() => setScanning(false)}>
              <Text style={styles.secondaryBtnText}>Pause scanner</Text>
            </Pressable>
          ) : null}

          {!scanning && !loading && !success ? (
            <Pressable style={styles.emeraldBtn} onPress={() => setScanning(true)}>
              <Text style={styles.emeraldBtnText}>Resume scanner</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable style={styles.back} onPress={onBack}>
        <Ionicons name="arrow-back" size={22} color={colors.slate300} />
      </Pressable>
      <View>
        <Text style={styles.headerTitle}>Scan QR Code</Text>
        <Text style={styles.headerSub}>Scan teacher QR on your phone</Text>
      </View>
    </View>
  );
}

function GpsPill({ status }: { status: 'idle' | 'acquiring' | 'success' | 'failed' }) {
  const label =
    status === 'acquiring'
      ? 'Acquiring GPS…'
      : status === 'success'
        ? 'GPS locked'
        : status === 'failed'
          ? 'GPS unavailable'
          : 'GPS ready';
  const tone =
    status === 'success'
      ? styles.gpsSuccess
      : status === 'failed'
        ? styles.gpsFailed
        : status === 'acquiring'
          ? styles.gpsPending
          : styles.gpsIdle;

  return (
    <View style={[styles.gpsPill, tone]}>
      <Text style={styles.gpsText}>{label}</Text>
    </View>
  );
}

const corner = {
  position: 'absolute' as const,
  width: 28,
  height: 28,
  borderColor: colors.indigo400,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.slate950,
    paddingTop: 52,
    paddingHorizontal: 16,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.slate950,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  back: { padding: 6 },
  headerTitle: { color: colors.white, fontSize: 20, fontWeight: '700' },
  headerSub: { color: colors.slate400, fontSize: 12, marginTop: 2 },
  gpsRow: { marginBottom: 12 },
  gpsPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  gpsIdle: { backgroundColor: colors.slate800, borderColor: colors.slate700 },
  gpsPending: { backgroundColor: 'rgba(99, 102, 241, 0.15)', borderColor: 'rgba(129, 140, 248, 0.35)' },
  gpsSuccess: { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(52, 211, 153, 0.35)' },
  gpsFailed: { backgroundColor: 'rgba(248, 113, 113, 0.15)', borderColor: 'rgba(248, 113, 113, 0.35)' },
  gpsText: { color: colors.slate300, fontSize: 12, fontWeight: '600' },
  cameraWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.slate700,
    height: 320,
    backgroundColor: '#000',
  },
  camera: { flex: 1 },
  cameraPaused: { alignItems: 'center', justifyContent: 'center' },
  frameOverlay: { ...StyleSheet.absoluteFillObject },
  cornerTL: { ...corner, top: 12, left: 12, borderTopWidth: 2, borderLeftWidth: 2 },
  cornerTR: { ...corner, top: 12, right: 12, borderTopWidth: 2, borderRightWidth: 2 },
  cornerBL: { ...corner, bottom: 12, left: 12, borderBottomWidth: 2, borderLeftWidth: 2 },
  cornerBR: { ...corner, bottom: 12, right: 12, borderBottomWidth: 2, borderRightWidth: 2 },
  scanHint: {
    textAlign: 'center',
    color: colors.slate400,
    fontSize: 14,
    marginTop: 14,
  },
  card: {
    backgroundColor: colors.slate900,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.slate800,
  },
  title: { color: colors.white, fontSize: 18, fontWeight: '700' },
  hint: { color: colors.slate400, fontSize: 14, marginTop: 8, lineHeight: 20 },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: colors.indigo600,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: colors.white, fontWeight: '700', fontSize: 16 },
  emeraldBtn: {
    marginTop: 16,
    backgroundColor: colors.emerald600,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  emeraldBtnText: { color: colors.white, fontWeight: '700', fontSize: 15 },
  secondaryBtn: {
    marginTop: 12,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.slate700,
  },
  secondaryBtnText: { color: colors.slate300, fontWeight: '600' },
  errorBox: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.3)',
  },
  errorText: { color: colors.red400, textAlign: 'center', fontSize: 14 },
  successBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  successTitle: {
    color: colors.emerald400,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 12,
  },
});
