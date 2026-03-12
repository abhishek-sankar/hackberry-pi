import cv2
import base64
from config import CAMERA_INDEX, CAPTURE_WIDTH, CAPTURE_HEIGHT, JPEG_QUALITY


class Camera:
    def __init__(self):
        self.cap = None

    def start(self):
        self.cap = cv2.VideoCapture(CAMERA_INDEX)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAPTURE_WIDTH)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAPTURE_HEIGHT)
        if not self.cap.isOpened():
            raise RuntimeError(f"Cannot open camera at index {CAMERA_INDEX}")
        print(f"Camera started: {CAPTURE_WIDTH}x{CAPTURE_HEIGHT}")

    def capture_frame_base64(self) -> tuple[str, bytes]:
        """Capture a frame and return (base64_string, raw_jpeg_bytes)."""
        ret, frame = self.cap.read()
        if not ret:
            raise RuntimeError("Failed to capture frame")
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
        _, jpeg_buf = cv2.imencode(".jpg", frame, encode_params)
        jpeg_bytes = jpeg_buf.tobytes()
        b64_str = base64.b64encode(jpeg_bytes).decode("utf-8")
        return b64_str, jpeg_bytes

    def stop(self):
        if self.cap:
            self.cap.release()
            print("Camera stopped")


if __name__ == "__main__":
    cam = Camera()
    cam.start()
    b64, raw = cam.capture_frame_base64()
    print(f"Captured frame: {len(raw)} bytes JPEG, {len(b64)} chars base64")
    with open("test_frame.jpg", "wb") as f:
        f.write(raw)
    print("Saved test_frame.jpg")
    cam.stop()
