import React from 'react';
import { View, Text, ScrollView } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <ScrollView contentContainerStyle={{ padding: 30, paddingTop: 80, flexGrow: 1, backgroundColor: '#fee2e2' }}>
          <Text style={{ fontSize: 22, color: '#991b1b', fontWeight: 'bold', marginBottom: 20 }}>
            App Crashed!
          </Text>
          <Text style={{ fontSize: 14, color: '#7f1d1d', fontWeight: 'bold' }}>
            {this.state.error?.toString()}
          </Text>
          <Text style={{ fontSize: 12, color: '#991b1b', marginTop: 20, fontFamily: 'monospace' }}>
            {this.state.errorInfo?.componentStack}
          </Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}
