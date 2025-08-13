const fs = require("fs");
const path = require("path");

const podspecPath = path.join(
  __dirname,
  "../node_modules/react-native-audio-recorder-player/ios/AudioRecorderPlayer.podspec"
);

if (fs.existsSync(podspecPath)) {
  let content = fs.readFileSync(podspecPath, "utf8");
  const newContent = content.replace(/^\s*s\.dependency\s+['"]NitroModules['"].*$/m, "# $&");
  if (newContent !== content) {
    fs.writeFileSync(podspecPath, newContent, "utf8");
    console.log("✅ Removed NitroModules dependency from AudioRecorderPlayer.podspec");
  } else {
    console.log("ℹ️ No NitroModules dependency found in podspec.");
  }
} else {
  console.log("⚠️ Podspec file not found:", podspecPath);
}
