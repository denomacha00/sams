import React, { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

const logo = require('../../assets/logo.png');

interface Props {
  onFinish: () => void;
}

export function SplashScreen({ onFinish }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    const t = setTimeout(onFinish, 1600);
    return () => clearTimeout(t);
  }, [onFinish, opacity, scale]);

  return (
    <View style={styles.container}>
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <Image source={logo} style={styles.logo} resizeMode="contain" accessibilityLabel="SAMS logo" />
      </Animated.View>
      <Animated.Text style={[styles.subtitle, { opacity }]}>
        Smart Attendance Management System
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.slate950,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  logo: {
    width: 280,
    height: 120,
  },
  subtitle: {
    marginTop: 16,
    fontSize: 13,
    color: colors.slate400,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});
