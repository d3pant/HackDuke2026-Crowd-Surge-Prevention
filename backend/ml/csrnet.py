"""CSRNet crowd density — architecture matches leeyeehoo/CSRNet-pytorch (ShanghaiTech weights)."""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


def _make_layers(
    cfg: list,
    in_channels: int = 3,
    batch_norm: bool = False,
    dilation: bool = False,
) -> nn.Sequential:
    if dilation:
        d_rate = 2
    else:
        d_rate = 1
    layers: list[nn.Module] = []
    for v in cfg:
        if v == "M":
            layers += [nn.MaxPool2d(kernel_size=2, stride=2)]
        else:
            conv2d = nn.Conv2d(
                in_channels, v, kernel_size=3, padding=d_rate, dilation=d_rate
            )
            if batch_norm:
                layers += [conv2d, nn.BatchNorm2d(v), nn.ReLU(inplace=True)]
            else:
                layers += [conv2d, nn.ReLU(inplace=True)]
            in_channels = v
    return nn.Sequential(*layers)


class CSRNet(nn.Module):
    """Same layout as CSRNet-pytorch ``model.py`` (frontend + dilated backend + 1x1 head)."""

    def __init__(self) -> None:
        super().__init__()
        self.frontend_feat = [64, 64, "M", 128, 128, "M", 256, 256, 256, "M", 512, 512, 512]
        self.backend_feat = [512, 512, 512, 256, 128, 64]
        self.frontend = _make_layers(self.frontend_feat, in_channels=3, dilation=False)
        self.backend = _make_layers(
            self.backend_feat, in_channels=512, dilation=True
        )
        self.output_layer = nn.Conv2d(64, 1, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.frontend(x)
        x = self.backend(x)
        x = self.output_layer(x)
        return x

    def infer(self, frame_bgr: np.ndarray) -> np.ndarray:
        """Run inference on a BGR uint8 frame; return density map (H, W) float32."""
        import cv2

        if frame_bgr.ndim != 3 or frame_bgr.shape[2] != 3:
            raise ValueError("frame_bgr must be HxWx3 BGR")

        orig_h, orig_w = frame_bgr.shape[0], frame_bgr.shape[1]
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        square = 512
        scale = min(square / orig_h, square / orig_w)
        new_h = max(1, int(round(orig_h * scale)))
        new_w = max(1, int(round(orig_w * scale)))
        resized = cv2.resize(rgb, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        canvas = np.zeros((square, square, 3), dtype=np.float32)
        y0 = (square - new_h) // 2
        x0 = (square - new_w) // 2
        canvas[y0 : y0 + new_h, x0 : x0 + new_w] = resized.astype(np.float32) / 255.0

        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        chw = np.transpose(canvas, (2, 0, 1))
        chw = (chw - mean[:, None, None]) / std[:, None, None]
        tensor = torch.from_numpy(chw).unsqueeze(0).to(next(self.parameters()).device)

        with torch.no_grad():
            density_small = self.forward(tensor)
            density_512 = F.interpolate(
                density_small,
                size=(square, square),
                mode="bilinear",
                align_corners=False,
            )
            d = density_512.squeeze().cpu().numpy().astype(np.float32)

        valid = d[y0 : y0 + new_h, x0 : x0 + new_w]
        out = cv2.resize(valid, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
        return out.astype(np.float32)

    def load_weights(self, path: str) -> None:
        """Load a PyTorch checkpoint (``.pth`` or ``.pth.tar``); prints confirmation."""
        raw = torch.load(path, map_location="cpu", weights_only=False)
        if isinstance(raw, dict):
            if "state_dict" in raw:
                state = raw["state_dict"]
            elif "model_state_dict" in raw:
                state = raw["model_state_dict"]
            else:
                state = raw
        else:
            state = raw
        if isinstance(state, dict) and state and isinstance(next(iter(state.keys())), str):
            if next(iter(state.keys())).startswith("module."):
                state = {k.replace("module.", "", 1): v for k, v in state.items()}
        missing, unexpected = self.load_state_dict(state, strict=False)
        print(
            f"CSRNet weights loaded from {path} (missing={len(missing)}, unexpected={len(unexpected)})"
        )
