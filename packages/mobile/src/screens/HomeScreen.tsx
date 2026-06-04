import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { UserRole } from '@sams/shared';
import { colors } from '../theme/colors';
import { useAuth } from '../auth/AuthContext';
import { initialsFromName, navItemsForRole, roleLabel } from '../navigation/roleNav';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'Home'>;

export function HomeScreen() {
  const { user, logout } = useAuth();
  const navigation = useNavigation<Nav>();
  if (!user) return null;

  const items = navItemsForRole(user.role);
  const showScanShortcut = user.role === UserRole.STUDENT;
  const showFaceShortcut =
    user.role === UserRole.TEACHER || user.role === UserRole.HOD;

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initialsFromName(user.fullName)}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={styles.greeting}>Welcome back</Text>
            <Text style={styles.name}>{user.fullName}</Text>
            <View style={styles.rolePill}>
              <Text style={styles.roleText}>{roleLabel(user.role)}</Text>
            </View>
          </View>
        </View>
        <Pressable onPress={logout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </View>

      {showScanShortcut ? (
        <Pressable
          style={styles.scanBanner}
          onPress={() => navigation.navigate('ScanQR')}
        >
          <Ionicons name="qr-code" size={28} color={colors.white} />
          <View style={styles.scanBannerText}>
            <Text style={styles.scanBannerTitle}>Quick scan</Text>
            <Text style={styles.scanBannerSub}>Scan teacher QR on your phone</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.emerald200} />
        </Pressable>
      ) : null}

      {showFaceShortcut ? (
        <Pressable
          style={styles.faceBanner}
          onPress={() => navigation.navigate('FaceScan')}
        >
          <Ionicons name="scan" size={28} color={colors.white} />
          <View style={styles.scanBannerText}>
            <Text style={styles.scanBannerTitle}>Face attendance</Text>
            <Text style={styles.scanBannerSub}>Scan students on this device</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.indigo400} />
        </Pressable>
      ) : null}

      <Text style={styles.sectionTitle}>Quick actions</Text>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            style={styles.navCard}
            onPress={() => {
              if (item.screen === 'ScanQR') {
                navigation.navigate('ScanQR');
              } else if (item.screen === 'FaceScan') {
                navigation.navigate('FaceScan');
              } else {
                navigation.navigate('Placeholder', {
                  title: item.title,
                  subtitle: item.subtitle,
                });
              }
            }}
          >
            <View
              style={[
                styles.navIcon,
                item.screen === 'ScanQR' && styles.navIconScan,
                item.screen === 'FaceScan' && styles.navIconFace,
              ]}
            >
              <Ionicons
                name={item.icon as keyof typeof Ionicons.glyphMap}
                size={22}
                color={
                  item.screen === 'ScanQR' || item.screen === 'FaceScan'
                    ? colors.white
                    : colors.indigo400
                }
              />
            </View>
            <View style={styles.navBody}>
              <Text style={styles.navTitle}>{item.title}</Text>
              <Text style={styles.navSubtitle}>{item.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.slate500} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.slate950,
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  profileRow: { flexDirection: 'row', gap: 14, flex: 1 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.indigo600,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.45)',
  },
  avatarText: { color: colors.white, fontWeight: '800', fontSize: 16 },
  profileText: { flex: 1 },
  greeting: { color: colors.slate400, fontSize: 13 },
  name: { color: colors.white, fontSize: 20, fontWeight: '700', marginTop: 2 },
  rolePill: {
    alignSelf: 'flex-start',
    marginTop: 6,
    backgroundColor: 'rgba(79, 70, 229, 0.25)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.35)',
  },
  roleText: { color: colors.indigo400, fontSize: 11, fontWeight: '600' },
  logoutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.slate700,
  },
  logoutText: { color: colors.slate300, fontSize: 12, fontWeight: '600' },
  scanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.emerald600,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  faceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.indigo600,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  scanBannerText: { flex: 1 },
  scanBannerTitle: { color: colors.white, fontWeight: '700', fontSize: 16 },
  scanBannerSub: { color: colors.emerald200, fontSize: 12, marginTop: 2 },
  sectionTitle: { color: colors.white, fontSize: 17, fontWeight: '700', marginBottom: 12 },
  list: { flex: 1 },
  listContent: { paddingBottom: 28, gap: 10 },
  navCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.slate900,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.slate800,
    gap: 12,
  },
  navIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(79, 70, 229, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconScan: { backgroundColor: 'rgba(5, 150, 105, 0.35)' },
  navIconFace: { backgroundColor: 'rgba(79, 70, 229, 0.45)' },
  navBody: { flex: 1 },
  navTitle: { color: colors.white, fontSize: 15, fontWeight: '700' },
  navSubtitle: { color: colors.slate400, fontSize: 12, marginTop: 3 },
});
