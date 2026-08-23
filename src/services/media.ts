import { request } from './http';

export type MediaType = 'image' | 'video';

export interface MediaResource {
  id: number;
  url: string;
  mediaType: MediaType;
  mimeType: string;
}

export function uploadMedia(endpoint: string, file: File) {
  const body = new FormData();
  body.append('file', file);
  return request<MediaResource>(endpoint, { method: 'POST', body });
}

export function releaseTemporaryMedia(endpoint: string, mediaId: number) {
  return request<boolean>(`${endpoint}?mediaId=${mediaId}`, { method: 'DELETE' });
}

export function createVideoFirstFrame(videoUrl: string) {
  return new Promise<Blob>((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      const maxWidth = 640;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('视频封面生成失败'));
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('视频封面生成失败'));
        },
        'image/jpeg',
        0.85,
      );
    };
    video.onerror = () => reject(new Error('视频读取失败'));
    video.src = videoUrl;
    video.load();
  });
}
