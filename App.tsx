import 'react-native-gesture-handler';
import 'react-native-reanimated';
// @ts-ignore
import "./global.css";
import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ErrorBoundary } from './ErrorBoundary';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://4823ae2cb52c014cbaa58bda55d5ce78@o4510713966166016.ingest.de.sentry.io/4510714043367504',
  debug: false,
});

export default Sentry.wrap(function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <NavigationContainer>
          <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
});
