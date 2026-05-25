import os
from typing import Optional

import cv2

from config import STORAGE_BASE_DIR, STORAGE_PUBLIC_PREFIX


class StorageService:
    def __init__(self, base_dir: str = STORAGE_BASE_DIR, public_prefix: str = STORAGE_PUBLIC_PREFIX):
        self.base_dir = base_dir
        self.public_prefix = public_prefix.rstrip("/")

        self.preview_dir = os.path.join(base_dir, "previews")
        self.overlay_dir = os.path.join(base_dir, "overlays")
        self._ensure_directories()

    def _ensure_directories(self) -> None:
        os.makedirs(self.preview_dir, exist_ok=True)
        os.makedirs(self.overlay_dir, exist_ok=True)

    def _build_filename(self, stt, frame_index: int, image_type: str) -> str:
        return f"job_{stt}_frame_{frame_index}_{image_type}.jpg"

    def _public_path(self, folder_name: str, filename: str) -> str:
        return f"{self.public_prefix}/{folder_name}/{filename}".replace("\\", "/")

    def _write_image(self, file_path: str, image, quality: int) -> bool:
        extension = os.path.splitext(file_path)[1] or ".jpg"
        ok, encoded = cv2.imencode(
            extension,
            image,
            [int(cv2.IMWRITE_JPEG_QUALITY), quality],
        )
        if not ok:
            return False

        encoded.tofile(file_path)
        return os.path.exists(file_path) and os.path.getsize(file_path) > 0

    def _save_image(
        self,
        image,
        folder: str,
        folder_name: str,
        stt,
        frame_index: int,
        image_type: str,
        quality: int = 60,
    ) -> Optional[str]:
        if image is None:
            return None

        filename = self._build_filename(stt, frame_index, image_type)
        file_path = os.path.join(folder, filename)

        ok = self._write_image(file_path, image, quality)
        if not ok:
            raise RuntimeError(f"Cannot save image: {file_path}")

        return self._public_path(folder_name, filename)

    def save_preview(self, image, stt, frame_index: int, quality: int = 60) -> Optional[str]:
        return self._save_image(
            image=image,
            folder=self.preview_dir,
            folder_name="previews",
            stt=stt,
            frame_index=frame_index,
            image_type="roi",
            quality=quality,
        )

    def save_overlay(self, image, stt, frame_index: int, quality: int = 60) -> Optional[str]:
        return self._save_image(
            image=image,
            folder=self.overlay_dir,
            folder_name="overlays",
            stt=stt,
            frame_index=frame_index,
            image_type="overlay",
            quality=quality,
        )

    def save_frame_bundle(
        self,
        stt,
        frame_index: int,
        roi_image=None,
        overlay_image=None,
        quality: int = 60,
    ) -> dict:
        return {
            "frame_index": frame_index,
            "roi_path": self.save_preview(roi_image, stt, frame_index, quality),
            "overlay_path": self.save_overlay(overlay_image, stt, frame_index, quality),
        }
