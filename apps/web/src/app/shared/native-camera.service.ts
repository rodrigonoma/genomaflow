import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

@Injectable({ providedIn: 'root' })
export class NativeCameraService {

  isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  async pickImage(): Promise<{ base64: string; mimeType: string } | null> {
    if (!this.isNative()) return null;

    const image = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt  // asks user: camera or gallery
    });

    if (!image.base64String) return null;

    return {
      base64: image.base64String,
      mimeType: `image/${image.format}`
    };
  }
}
