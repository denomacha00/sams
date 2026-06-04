import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { UserRole } from '@sams/shared';
import { colors } from '../theme/colors';
import { useAuth } from '../auth/AuthContext';
import {
  checkBiometricFeatureAccess,
  fetchActiveTeacherSession,
  submitBiometricMatch,
} from '../api/client';
import { getApiErrorMessage } from '../lib/apiError';
import { getFaceDescriptorBridge } from '../components/FaceDescriptorBridge';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'FaceScan'>;

const ALLOWED_ROLES = new Set<string>([UserRole.TEACHER, UserRole.HOD]);

export function FaceScanScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [session, setSession] = useState<Awaited<ReturnType<typeof fetchActiveTeacherSession>>>(null);
  const [featureGated, setFeatureGated] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchName, setMatchName] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);

  const roleOk = user && ALLOWED_ROLES.has(user.role);

  const loadSession = useCallback(async () => {
    setSessionLoading(true);
    try {
      const active = await fetchActiveTeacherSession(user?.id);
      setSession(active);
      if (!active) {
        setError('No active attendance session. Start a session on the web app first.');
      } else {
        setError(null);
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Could not load active session'));
    } finally {
      setSessionLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (roleOk) void loadSession();
    void checkBiometricFeatureAccess().then((ok) => {
      if (!ok) setFeatureGated(true);
    });
  }, [loadSession, roleOk]);

  useEffect(() => {
    const id = setInterval(() => {
      if (getFaceDescriptorBridge()?.ready()) setModelsReady(true);
    }, 500);
    return () => clearInterval(id);
  }, []);

  const scanStudentFace = async () => {
    if (!session || !cameraRef.current || !cameraReady) return;
    const bridge = getFaceDescriptorBridge();
    if (!bridge?.ready()) {
      setError('Face models still loading. Wait a few seconds and try again.');
      return;
    }

    setLoading(true);
    setError(null);
    setMatchName(null);
    setConfidence(null);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        base64: true,
        skipProcessing: false,
      });
      if (!photo?.base64) {
        throw new Error('Could not capture photo. Try again.');
      }

      const descriptor = await bridge.extractFromBase64(photo.base64);
      const result = await submitBiometricMatch({
        descriptor,
        classId: session.classId,
        sessionId: session.id,
      });

      if (result.matched) {
        setMatchName(result.studentName);
        setConfidence(result.confidence);
      } else {
        setError(
          `No match found. Confidence: ${((result.confidence || 0) * 100).toFixed(1)}%. Ask the student to face the camera clearly.`,
        );
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Biometric verification failed'));
    } finally {
      setLoading(false);
    }
  };

  const resetForNext = () => {
    setMatchName(null);
    setConfidence(null);
    setError(null);
  };

  if (!roleOk) {
    return (
      <Shell onBack={() => navigation.goBack()}>
        <Card
          title="Not available for your role"
          message="Face attendance is for teachers and HODs running the class. Students mark attendance with Scan QR on their own phone."
        />
      </Shell>
    );
  }

  if (featureGated) {
    return (
      <Shell onBack={() => navigation.goBack()}>
        <Card
          title="Face attendance unavailable"
          message="Biometric scanning requires a Professional or Enterprise plan for your school."
        />
      </Shell>
    );
  }

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.indigo400} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <Shell onBack={() => navigation.goBack()}>
        <Card
          title="Camera access needed"
          message="Allow the camera so you can scan each student's face on this device."
        />
        <Pressable style={styles.primaryBtn} onPress={requestPermission}>
          <Text style={styles.primaryBtnText}>Allow camera</Text>
        </Pressable>
      </Shell>
    );
  }

  return (
    <View style={styles.container}>
      <Header onBack={() => navigation.goBack()} />

      <Text style={styles.flowNote}>
        Scan student face on this device. Students do not use their phones for face check-in (they
        use QR on their own phone). Login fingerprint stays on each user&apos;s own device.
      </Text>

      {sessionLoading ? (
        <ActivityIndicator color={colors.indigo400} style={{ marginVertical: 12 }} />
      ) : session ? (
        <View style={styles.sessionPill}>
          <Text style={styles.sessionText}>Active session · {session.className ?? 'Class'}</Text>
        </View>
      ) : (
        <Pressable style={styles.refreshRow} onPress={() => void loadSession()}>
          <Ionicons name="refresh" size={16} color={colors.indigo400} />
          <Text style={styles.refreshText}>Refresh session</Text>
        </Pressable>
      )}

      {!modelsReady ? (
        <Text style={styles.modelHint}>Loading face detection models…</Text>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {matchName ? (
        <View style={styles.successBox}>
          <Ionicons name="checkmark-circle" size={44} color={colors.emerald400} />
          <Text style={styles.successTitle}>Present — {matchName}</Text>
          {confidence != null ? (
            <Text style={styles.confidence}>
              Confidence: {(confidence * 100).toFixed(1)}%
            </Text>
          ) : null}
          <Pressable style={styles.emeraldBtn} onPress={resetForNext}>
            <Text style={styles.emeraldBtnText}>Next student</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.cameraWrap}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="front"
              onCameraReady={() => setCameraReady(true)}
            />
            <View style={styles.frameOverlay} pointerEvents="none">
              <View style={styles.faceOval} />
            </View>
          </View>

          <Text style={styles.scanHint}>
            {loading
              ? 'Matching face…'
              : "Hold the phone so the student's face is inside the oval, then tap Scan"}
          </Text>

          <Pressable
            style={[styles.primaryBtn, (!session || loading || !cameraReady) && styles.btnDisabled]}
            disabled={!session || loading || !cameraReady}
            onPress={() => void scanStudentFace()}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.primaryBtnText}>Scan student face</Text>
            )}
          </Pressable>
        </>
      )}
    </View>
  );
}

function Shell({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.container}>
      <Header onBack={onBack} />
      {children}
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable style={styles.back} onPress={onBack}>
        <Ionicons name="arrow-back" size={22} color={colors.slate300} />
      </Pressable>
      <View style={styles.headerText}>
        <Text style={styles.headerTitle}>Scan student face</Text>
        <Text style={styles.headerSub}>Teacher or HOD device · point camera at student</Text>
      </View>
    </View>
  );
}

function Card({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardMessage}>{message}</Text>
    </View>
  );
}

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
    marginBottom: 10,
  },
  headerText: { flex: 1 },
  back: { padding: 6 },
  headerTitle: { color: colors.white, fontSize: 20, fontWeight: '700' },
  headerSub: { color: colors.slate400, fontSize: 12, marginTop: 2 },
  flowNote: {
    color: colors.slate400,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  sessionPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 10,
  },
  sessionText: { color: colors.emerald400, fontSize: 12, fontWeight: '600' },
  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  refreshText: { color: colors.indigo400, fontSize: 13, fontWeight: '600' },
  modelHint: { color: colors.slate500, fontSize: 12, marginBottom: 8 },
  cameraWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.slate700,
    height: 340,
    backgroundColor: '#000',
  },
  camera: { flex: 1 },
  frameOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceOval: {
    width: 200,
    height: 260,
    borderRadius: 120,
    borderWidth: 2,
    borderColor: 'rgba(99, 102, 241, 0.55)',
  },
  scanHint: {
    textAlign: 'center',
    color: colors.slate400,
    fontSize: 14,
    marginTop: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.slate900,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.slate800,
  },
  cardTitle: { color: colors.white, fontSize: 18, fontWeight: '700' },
  cardMessage: { color: colors.slate400, fontSize: 14, marginTop: 8, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: colors.indigo600,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  btnDisabled: { opacity: 0.45 },
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
    paddingBottom: 48,
  },
  successTitle: {
    color: colors.emerald400,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center',
  },
  confidence: { color: colors.slate500, fontSize: 12, marginTop: 6 },
});
