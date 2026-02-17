import {
	AeConstraintModeEnum,
	AeExposureModeEnum,
	AeFlickerModeEnum,
	AeMeteringModeEnum,
	AeStateEnum,
	AfMeteringEnum,
	AfModeEnum,
	AfPauseEnum,
	AfPauseStateEnum,
	AfRangeEnum,
	AfSpeedEnum,
	AfStateEnum,
	AfTriggerEnum,
	AnalogueGainModeEnum,
	AwbModeEnum,
	CameraControlId,
	ExposureTimeModeEnum,
	HdrChannelEnum,
	HdrModeEnum
} from "../proto/camera_control";

export { CameraControlId };

export type CameraControlValue =
	AeStateEnum |
	AeMeteringModeEnum |
	AeConstraintModeEnum |
	AeExposureModeEnum |
	ExposureTimeModeEnum |
	AnalogueGainModeEnum |
	AeFlickerModeEnum |
	AwbModeEnum |
	AfModeEnum |
	AfRangeEnum |
	AfSpeedEnum |
	AfMeteringEnum |
	AfTriggerEnum |
	AfPauseEnum |
	AfStateEnum |
	AfPauseStateEnum |
	HdrModeEnum |
	HdrChannelEnum;
