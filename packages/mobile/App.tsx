import React, { useCallback, useState } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { SplashScreen } from './src/screens/SplashScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ScanQRScreen } from './src/screens/ScanQRScreen';
import { FaceScanScreen } from './src/screens/FaceScanScreen';
import { PlaceholderScreen } from './src/screens/PlaceholderScreen';
import { FaceDescriptorBridge } from './src/components/FaceDescriptorBridge';
import { colors } from './src/theme/colors';
import type { MainStackParamList } from './src/navigation/types';

export type AuthStackParamList = {
  Login: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.indigo500,
    background: colors.slate950,
    card: colors.slate900,
    text: colors.white,
    border: colors.slate800,
  },
};

function MainNavigator() {
  return (
    <MainStack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: colors.slate950 },
      }}
    >
      <MainStack.Screen name="Home" component={HomeScreen} />
      <MainStack.Screen name="ScanQR" component={ScanQRScreen} />
      <MainStack.Screen name="FaceScan" component={FaceScanScreen} />
      <MainStack.Screen name="Placeholder" component={PlaceholderScreen} />
    </MainStack.Navigator>
  );
}

function RootNavigator() {
  const { user, bootstrapping } = useAuth();
  const [splashDone, setSplashDone] = useState(false);
  const onSplashFinish = useCallback(() => setSplashDone(true), []);

  if (!splashDone || bootstrapping) {
    return <SplashScreen onFinish={onSplashFinish} />;
  }

  if (!user) {
    return (
      <AuthStack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        <AuthStack.Screen name="Login" component={LoginScreen} />
      </AuthStack.Navigator>
    );
  }

  return <MainNavigator />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="light" />
          <FaceDescriptorBridge />
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
