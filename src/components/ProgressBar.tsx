import React from 'react';
import { View, StyleSheet } from 'react-native';

const ProgressBar = ({ progress }: { progress: number }) => {
  return (
    <View style={styles.container}>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    height: 10,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#e0e0e0',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4a8cff',
    borderRadius: 5,
  },
});

export default ProgressBar;