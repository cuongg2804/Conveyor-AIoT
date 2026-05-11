import torch
from anomalib.models import Patchcore
from anomalib.engine import Engine
import anomalib
if not hasattr(anomalib, "PrecisionType"):
    class PrecisionType(str):
        def __new__(cls, v, *args, **kwargs):
            return str.__new__(cls, v)
        FP32 = "fp32"
        FP16 = "fp16"
    anomalib.PrecisionType = PrecisionType

ckpt = torch.load("model (9).ckpt", map_location="cpu")

state_dict = ckpt["state_dict"]

print("Số key trong state_dict:", len(state_dict))

for k, v in state_dict.items():
    if torch.is_tensor(v):
        print(k, v.shape, v.dtype)