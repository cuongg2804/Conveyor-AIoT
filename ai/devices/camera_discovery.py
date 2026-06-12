import ipaddress
import re


IPV4_PATTERN = re.compile(
    r"(?<!\d)(?:25[0-5]|2[0-4]\d|1?\d?\d)"
    r"(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?!\d)"
)


def safe_get_attr(obj, name, default=None):
    try:
        return getattr(obj, name, default)
    except Exception:
        return default


def normalize_ip(value):
    if value is None or value == "":
        return ""

    if isinstance(value, int):
        try:
            return str(ipaddress.IPv4Address(value))
        except Exception:
            return ""

    match = IPV4_PATTERN.search(str(value))
    return match.group(0) if match else ""


def extract_device_ip(device_info):
    preferred_names = [
        "ip_address",
        "current_ip",
        "current_ip_address",
        "device_ip_address",
        "GevDeviceIPAddress",
        "CurrentIPAddress",
    ]

    for name in preferred_names:
        ip = normalize_ip(safe_get_attr(device_info, name))
        if ip:
            return ip

    property_dict = safe_get_attr(device_info, "property_dict", {}) or {}
    if isinstance(property_dict, dict):
        for key, value in property_dict.items():
            key_text = str(key).lower()
            if "ip" in key_text or "address" in key_text:
                ip = normalize_ip(value)
                if ip:
                    return ip

    for name in ["display_name", "id_", "user_defined_name", "parent"]:
        ip = normalize_ip(safe_get_attr(device_info, name))
        if ip:
            return ip

    return ""


def device_to_dict(index, device_info):
    return {
        "index": index,
        "ip": extract_device_ip(device_info),
        "vendor": str(safe_get_attr(device_info, "vendor", "") or ""),
        "model": str(safe_get_attr(device_info, "model", "") or ""),
        "serial_number": str(
            safe_get_attr(device_info, "serial_number", "") or ""
        ),
        "display_name": str(
            safe_get_attr(device_info, "display_name", "") or ""
        ),
        "id": str(safe_get_attr(device_info, "id_", "") or ""),
        "access_status": str(
            safe_get_attr(device_info, "access_status", "") or ""
        ),
    }


def extract_node_map_ip(node_map):
    for name in [
        "GevCurrentIPAddress",
        "GevDeviceIPAddress",
        "CurrentIPAddress",
        "DeviceIPAddress",
    ]:
        try:
            if hasattr(node_map, name):
                ip = normalize_ip(getattr(node_map, name).value)
                if ip:
                    return ip
        except Exception:
            pass
    return ""


def probe_device_ip(harvester, index):
    image_acquirer = None
    try:
        image_acquirer = harvester.create(index)
        return extract_node_map_ip(image_acquirer.remote_device.node_map)
    except Exception:
        return ""
    finally:
        if image_acquirer is not None:
            try:
                image_acquirer.destroy()
            except Exception:
                pass


def scan_device_dicts(harvester):
    cameras = []
    for index, device_info in enumerate(harvester.device_info_list):
        camera = device_to_dict(index, device_info)
        if not camera["ip"]:
            camera["ip"] = probe_device_ip(harvester, index)
        cameras.append(camera)
    return cameras


def resolve_device_index(harvester, camera_ip):
    target_ip = normalize_ip(camera_ip)
    if not target_ip:
        raise RuntimeError("Camera IP is required")

    for index, device_info in enumerate(harvester.device_info_list):
        if extract_device_ip(device_info) == target_ip:
            return index

    for index, _device_info in enumerate(harvester.device_info_list):
        if probe_device_ip(harvester, index) == target_ip:
            return index

    detected_ips = [
        extract_device_ip(device_info)
        for device_info in harvester.device_info_list
        if extract_device_ip(device_info)
    ]
    detected_text = ", ".join(detected_ips) if detected_ips else "none"
    raise RuntimeError(
        f"Cannot find camera with IP {target_ip}. Detected camera IPs: {detected_text}"
    )
