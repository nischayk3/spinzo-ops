const { withGradleProperties } = require('expo/config-plugins');

// Expo SDK 57 / RN 0.86 (New Architecture + KSP + expo-updates) exhausts the
// default Gradle daemon memory (2 GiB heap / 512 MiB metaspace) during
// :expo-updates:kspReleaseKotlin and lintVital — raising it avoids
// java.lang.OutOfMemoryError: Metaspace.
const GRADLE_JVM_ARGS =
  '-Xmx4096m -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8';

module.exports = function withGradleJvmArgs(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const idx = props.findIndex((p) => p.key === 'org.gradle.jvmargs');
    if (idx >= 0) {
      props[idx].value = GRADLE_JVM_ARGS;
    } else {
      props.push({
        type: 'property',
        key: 'org.gradle.jvmargs',
        value: GRADLE_JVM_ARGS,
      });
    }
    return cfg;
  });
};
