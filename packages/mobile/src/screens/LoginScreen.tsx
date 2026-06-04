import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import { useAuth } from '../auth/AuthContext';
import { getApiBaseUrl } from '../api/client';
import { getApiErrorMessage } from '../lib/apiError';

const logo = require('../../assets/logo.png');

export function LoginScreen() {
  const { login, loading } = useAuth();
  const [schoolCode, setSchoolCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (schoolCode.trim().length < 3) {
      setError('Enter your school code (e.g. KHS2024).');
      return;
    }
    if (!identifier.trim() || !password) {
      setError('Username and password are required.');
      return;
    }
    try {
      await login(schoolCode, identifier, password);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Login failed. Please try again.'));
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Image source={logo} style={styles.logo} resizeMode="contain" accessibilityLabel="SAMS" />
          <Text style={styles.tagline}>Sign in to your school</Text>
        </View>

        <View style={styles.card}>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>School code</Text>
          <TextInput
            style={styles.input}
            value={schoolCode}
            onChangeText={(t) => setSchoolCode(t.toUpperCase())}
            placeholder="e.g. KHS2024"
            placeholderTextColor={colors.slate500}
            autoCapitalize="characters"
            autoCorrect={false}
          />

          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="Username, email, phone, or ADM"
            placeholderTextColor={colors.slate500}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            placeholderTextColor={colors.slate500}
            secureTextEntry
          />

          <Pressable
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.footer}>API: {getApiBaseUrl()}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.slate950 },
  scroll: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: { alignItems: 'center', marginBottom: 24 },
  logo: { width: 260, height: 100 },
  tagline: { marginTop: 8, color: colors.slate400, fontSize: 14 },
  card: {
    backgroundColor: colors.slate900,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.slate800,
  },
  label: {
    color: colors.slate300,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.slate950,
    borderWidth: 1,
    borderColor: colors.slate700,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.white,
    fontSize: 16,
  },
  button: {
    marginTop: 24,
    backgroundColor: colors.indigo600,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  errorBox: {
    backgroundColor: 'rgba(248, 113, 113, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  errorText: { color: colors.red400, fontSize: 14, textAlign: 'center' },
  footer: {
    marginTop: 20,
    textAlign: 'center',
    color: colors.slate500,
    fontSize: 11,
  },
});
