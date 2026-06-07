import argparse
import mmap
from pathlib import Path

DATA_TYPE_BYTES = {
  1: 4,   # float32
  2: 1,   # uint8
  3: 1,   # int8
  4: 2,   # uint16
  5: 2,   # int16
  6: 4,   # int32
  7: 8,   # int64
  9: 1,   # bool
  10: 2,  # float16
  11: 8,  # float64
  12: 4,  # uint32
  13: 8,  # uint64
}


def read_varint(data, offset):
  value = 0
  shift = 0
  while True:
    byte = data[offset]
    offset += 1
    value |= (byte & 0x7F) << shift
    if byte < 0x80:
      return value, offset
    shift += 7


def iter_fields(data, start=0, end=None):
  offset = start
  end = len(data) if end is None else end

  while offset < end:
    tag, offset = read_varint(data, offset)
    field_number = tag >> 3
    wire_type = tag & 7

    if wire_type == 0:
      value, offset = read_varint(data, offset)
      yield field_number, wire_type, value
    elif wire_type == 1:
      yield field_number, wire_type, (offset, offset + 8)
      offset += 8
    elif wire_type == 2:
      length, offset = read_varint(data, offset)
      value_start = offset
      offset += length
      yield field_number, wire_type, (value_start, offset)
    elif wire_type == 5:
      yield field_number, wire_type, (offset, offset + 4)
      offset += 4
    else:
      raise RuntimeError(f"Unsupported protobuf wire type: {wire_type}")


def parse_packed_varints(data, start, end):
  values = []
  while start < end:
    value, start = read_varint(data, start)
    values.append(value)
  return values


def parse_tensor_metadata(data, start, end):
  dims = []
  data_type = 1
  name = ""

  for field_number, wire_type, value in iter_fields(data, start, end):
    if field_number == 1:
      if wire_type == 0:
        dims.append(value)
      elif wire_type == 2:
        dims.extend(parse_packed_varints(data, value[0], value[1]))
    elif field_number == 2 and wire_type == 0:
      data_type = value
    elif field_number == 8 and wire_type == 2:
      name = data[value[0]:value[1]].decode("utf-8", errors="replace")

  return name, dims, data_type


def find_graph_range(data):
  for field_number, wire_type, value in iter_fields(data):
    if field_number == 7 and wire_type == 2:
      return value
  raise RuntimeError("GraphProto not found in ONNX file")


def format_mib(byte_count):
  return byte_count / (1024 * 1024)


def main():
  parser = argparse.ArgumentParser(
    description="Inspect likely PatchCore memory-bank tensors in an ONNX model."
  )
  parser.add_argument("onnx_path", type=Path, help="Path to the ONNX model")
  args = parser.parse_args()

  path = args.onnx_path.resolve()
  if not path.is_file():
    raise FileNotFoundError(f"ONNX model not found: {path}")

  candidates = []
  with path.open("rb") as model_file:
    with mmap.mmap(model_file.fileno(), 0, access=mmap.ACCESS_READ) as data:
      graph_start, graph_end = find_graph_range(data)

      for field_number, wire_type, value in iter_fields(data, graph_start, graph_end):
        if field_number != 5 or wire_type != 2:
          continue

        name, dims, data_type = parse_tensor_metadata(data, value[0], value[1])
        if len(dims) != 2:
          continue

        vectors, dimension = dims
        elements = vectors * dimension
        byte_count = elements * DATA_TYPE_BYTES.get(data_type, 4)
        candidates.append({
          "name": name,
          "vectors": vectors,
          "dimension": dimension,
          "elements": elements,
          "estimated_mib": format_mib(byte_count),
        })

  candidates.sort(key=lambda item: item["elements"], reverse=True)

  print(f"ONNX: {path}")
  print(f"2D initializer tensors: {len(candidates)}")

  if not candidates:
    print("No 2D initializer found. Memory bank may be stored in external data or built by graph nodes.")
    return

  print("\nLikely memory bank (largest 2D initializer):")
  largest = candidates[0]
  print(f"  name: {largest['name']}")
  print(f"  vectors: {largest['vectors']}")
  print(f"  dimension: {largest['dimension']}")
  print(f"  estimated float32 size: {largest['estimated_mib']:.2f} MiB")

  print("\nLargest 2D initializers:")
  for item in candidates[:10]:
    print(
      f"  {item['name']}: "
      f"{item['vectors']} vectors x {item['dimension']} dims "
      f"({item['estimated_mib']:.2f} MiB)"
    )


if __name__ == "__main__":
  main()
