# AI Runtime Structure

File nay mo ta nhanh trach nhiem cac phan trong folder `ai`.

## Entry point

- `main.py`: mo ung dung Tkinter.
- `gui/gui.py`: hien thi UI, nhan lenh tu web qua MQTT control, goi runtime factory de start/stop he thong.

## Runtime orchestration

- `runtime/controller_factory.py`: doc config bang tai tu MongoDB, khoi tao model, camera, Arduino, MQTT, MongoDB, storage, pipeline va `SystemController`.
- `controllers/controller.py`: vong lap inspection runtime. File nay xu ly ket qua batch sau pipeline: gui Arduino, update queue, log latency, luu anh, ghi MongoDB, publish MQTT, update GUI.

## AI pipeline

- `service/pipeline_service.py`: pipeline xu ly anh cho 1 batch:
  1. cho camera chup 3 frame,
  2. crop ROI bang contour,
  3. predict bang model PatchCore,
  4. tinh average score,
  5. quyet dinh `OK` / `NG`,
  6. tao overlay de hien thi va luu history.
- `core/patchcore_engine.py`: adapter cho model PatchCore/anomalib.
- `core/contour_roi.py`: tien xu ly anh va crop ROI san pham.

## External services and devices

- `devices/camera_hik.py`: camera Hikvision/IRayple qua Harvester.
- `devices/arduino_comm.py`: gui ket qua `OK` / `NG` xuong Arduino.
- `service/mqtt_service.py`: publish/subscribe MQTT.
- `service/control_cmd_service.py`: nhan lenh START/STOP/STATUS/RELOAD_CONFIG tu web.
- `service/mongo_service.py`: luu va doc inspection result.
- `service/conveyor_config_service.py`: doc config bang tai.
- `service/storage_service.py`: luu anh ROI va overlay.
- `service/result_queue.py`: queue debug ket qua gan nhat.
- `service/latency_logger.py`: ghi latency vao CSV.
