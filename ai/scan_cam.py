import os
import json
from harvesters.core import Harvester


# ================= CONFIG =================
# Sửa lại đường dẫn CTI theo máy của bạn
CTI_PATH = r"C:\Program Files\IRayple\MVP\Application\win64\CameraProcol\Cti\MVProducerGEV.cti"


def safe_get_attr(obj, attr_name, default=None):
    """
    Lấy thuộc tính an toàn vì mỗi hãng camera / CTI có thể trả field khác nhau.
    """
    try:
        return getattr(obj, attr_name, default)
    except Exception:
        return default


def device_to_dict(index, device_info):
    """
    Chuyển device_info của Harvester thành dict để dễ in/log/lưu DB.
    """
    return {
        "index": index,

        # Các field thường gặp
        "vendor": safe_get_attr(device_info, "vendor"),
        "model": safe_get_attr(device_info, "model"),
        "serial_number": safe_get_attr(device_info, "serial_number"),
        "display_name": safe_get_attr(device_info, "display_name"),
        "id": safe_get_attr(device_info, "id_"),
        "tl_type": safe_get_attr(device_info, "tl_type"),

        # Một số field có thể có tùy CTI/camera
        "user_defined_name": safe_get_attr(device_info, "user_defined_name"),
        "access_status": safe_get_attr(device_info, "access_status"),
        "parent": str(safe_get_attr(device_info, "parent", "")),
    }


def scan_cameras(cti_path=CTI_PATH):
    """
    Nạp file .cti, quét danh sách camera hiện có và trả về list dict.

    Lưu ý:
    - index chỉ là thứ tự tạm thời trong lần scan.
    - Khi lưu DB nên dùng serial_number hoặc id, không nên dùng index.
    """
    harvester = None

    try:
        if not os.path.exists(cti_path):
            raise FileNotFoundError(f"Khong tim thay file CTI: {cti_path}")

        harvester = Harvester()
        harvester.add_file(cti_path)
        harvester.update()

        devices = harvester.device_info_list
        print(f"Tim thay {len(devices)} camera trong CTI.")

        camera_list = []
        for index, device_info in enumerate(devices):
            camera_list.append(device_to_dict(index, device_info))

        return camera_list

    finally:
        if harvester is not None:
            try:
                harvester.reset()
            except Exception:
                pass


def print_camera_list(camera_list):
    """
    In danh sách camera ra terminal cho dễ kiểm tra.
    """
    print("\n========== CAMERA SCAN RESULT ==========")

    if len(camera_list) == 0:
        print("Khong tim thay camera nao.")
        return

    print(f"Tim thay {len(camera_list)} camera:\n")

    for cam in camera_list:
        print(f"--- Camera index {cam['index']} ---")
        print(f"Vendor           : {cam.get('vendor')}")
        print(f"Model            : {cam.get('model')}")
        print(f"Serial number    : {cam.get('serial_number')}")
        print(f"Device ID        : {cam.get('id')}")
        print(f"Display name     : {cam.get('display_name')}")
        print(f"User defined name: {cam.get('user_defined_name')}")
        print(f"Transport type   : {cam.get('tl_type')}")
        print(f"Access status    : {cam.get('access_status')}")
        print()

    print("Luu y:")
    print("- index chi la thu tu tam thoi sau moi lan scan.")
    print("- Nen luu serial_number hoac id vao DB de phan biet camera.")


def save_camera_list_to_json(camera_list, output_path="camera_scan_result.json"):
    """
    Lưu danh sách camera ra file JSON để backend/Web có thể đọc thử.
    """
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(camera_list, f, indent=2, ensure_ascii=False)

    print(f"Da luu ket qua scan vao: {output_path}")


if __name__ == "__main__":
    try:
        cameras = scan_cameras(CTI_PATH)

        print_camera_list(cameras)

        save_camera_list_to_json(
            camera_list=cameras,
            output_path="camera_scan_result.json",
        )

    except Exception as e:
        print("\nLoi khi scan camera:")
        print(str(e))