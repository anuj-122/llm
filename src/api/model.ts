import RNFS from 'react-native-fs';
import axios from 'axios';

export const downloadModel = async (
  filename: string,
  url: string,
  progressCallback: (bytesWritten: number, contentLength: number) => void
) => {
  const destPath = `${RNFS.DocumentDirectoryPath}/${filename}`;
  
  // Remove existing file if it exists
  try {
    await RNFS.unlink(destPath);
  } catch (error) {
    console.log('No existing file to remove');
  }

  // First check if the URL is accessible
  try {
    const response = await axios.head(url);
    if (response.status !== 200) {
      throw new Error(`Server returned status ${response.status}`);
    }
  } catch (error) {
    console.error('URL check failed:', error);
    throw new Error('Could not connect to model server');
  }

  const downloadOptions = {
    fromUrl: url,
    toFile: destPath,
    begin: (res: any) => {
      console.log('Download started, content length:', res.contentLength);
    },
    progress: (res: any) => {
      progressCallback(res.bytesWritten, res.contentLength);
    },
    progressDivider: 1,
    connectionTimeout: 30000, // 30 seconds
    readTimeout: 300000, // 5 minutes
  };

  try {
    const download = RNFS.downloadFile(downloadOptions);
    const result = await download.promise;

    if (result.statusCode === 200) {
      console.log('Download complete to:', destPath);
      
      // Verify file size
      const fileInfo = await RNFS.stat(destPath);
      if (fileInfo.size < 1000000) { // Less than 1MB is probably invalid
        throw new Error('Downloaded file is too small');
      }
      
      return destPath;
    } else {
      throw new Error(`Download failed with status ${result.statusCode}`);
    }
  } catch (error) {
    console.error('Download error:', error);
    // Clean up partially downloaded file
    try {
      await RNFS.unlink(destPath);
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }
    throw error;
  }
};