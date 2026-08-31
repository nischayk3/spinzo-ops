import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence } from 'react-native-reanimated';

interface WorkflowStepsProps {
  steps: string[];
  currentIndex: number;
}

const PulsingDot = () => {
  const opacity = useSharedValue(0.4);
  const scale = useSharedValue(0.8);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000 }),
        withTiming(0.4, { duration: 1000 })
      ),
      -1,
      true
    );
    scale.value = withRepeat(
      withSequence(
        withTiming(1.2, { duration: 1000 }),
        withTiming(0.8, { duration: 1000 })
      ),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View 
      style={animatedStyle} 
      className="w-3 h-3 rounded-full bg-[#994bff]" 
    />
  );
};

export const WorkflowSteps = ({ steps, currentIndex }: WorkflowStepsProps) => {
  return (
    <View className="flex-row items-center gap-1.5 mt-2">
      {steps.map((step, idx) => {
        if (idx < currentIndex) {
          // Completed
          return <View key={idx} className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />;
        } else if (idx === currentIndex) {
          // Current
          return <PulsingDot key={idx} />;
        } else {
          // Pending
          return <View key={idx} className="w-2.5 h-2.5 rounded-full bg-gray-200" />;
        }
      })}
    </View>
  );
};
