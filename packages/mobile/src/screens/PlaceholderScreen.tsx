import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'Placeholder'>;
type Route = RouteProp<MainStackParamList, 'Placeholder'>;

export function PlaceholderScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();

  return (
    <View style={styles.container}>
      <Pressable style={styles.back} onPress={() => navigation.goBack()}>
        <Ionicons name="arrow-back" size={22} color={colors.slate300} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="construct-outline" size={36} color={colors.indigo400} />
        </View>
        <Text style={styles.title}>{route.params.title}</Text>
        <Text style={styles.subtitle}>{route.params.subtitle}</Text>
        <Text style={styles.hint}>
          This screen is wired in the mobile app navigation. Full flows remain on the web app while
          mobile features roll out.
        </Text>
      </View>
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
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  backText: { color: colors.slate300, fontSize: 15, fontWeight: '600' },
  card: {
    backgroundColor: colors.slate900,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.slate800,
    alignItems: 'center',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: 'rgba(79, 70, 229, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { color: colors.white, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: colors.slate400, fontSize: 14, marginTop: 8, textAlign: 'center' },
  hint: {
    color: colors.slate500,
    fontSize: 13,
    marginTop: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
});
