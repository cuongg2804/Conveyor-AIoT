import tensorrt as trt
import onnx

def build_engine(onnx_path, engine_path):
    logger = trt.Logger(trt.Logger.WARNING)

    with trt.Builder(logger) as builder:
        config = builder.create_builder_config()

        # Quantize FP16 (safe cho feature matching)
        config.set_flag(trt.BuilderFlag.FP16)

        # Workspace
        config.max_workspace_size = 1 << 30  # 1GB

        with trt.OnnxParser(builder, logger) as parser:
            with open(onnx_path, 'rb') as f:
                if not parser.parse(f.read()):
                    print("Failed to parse ONNX")
                    return None

        engine = builder.build_engine(config)

        with open(engine_path, 'wb') as f:
            f.write(engine.serialize())

        return engine_path

# Build
build_engine(r"C:\Users\ASUS\Desktop\Conveyor-AIoT\rewrite\models\model (1).onnx", "patchcore.engine")