"""Selene lunar alarm clock — ESPHome external component.

Renders original moon-data LCD faces on a round panel and implements the full watch module
(time, moon time, sunrise/sunset, alarm + chime, stopwatch, demo). See README.md.
"""
from esphome import automation
import esphome.codegen as cg
from esphome.components import display, time as time_
import esphome.config_validation as cv
from esphome.const import CONF_ID, CONF_LATITUDE, CONF_LONGITUDE, CONF_ROTATION, CONF_TIME_ID, CONF_TRIGGER_ID

CODEOWNERS = ["@au12"]
DEPENDENCIES = ["display", "time"]

CONF_DISPLAY_ID = "display_id"
CONF_DEFAULT_FACE = "default_face"
CONF_ON_SOUND = "on_sound"
CONF_ON_LIGHT = "on_light"
CONF_ON_FACE_CHANGE = "on_face_change"
FACES = ["arc", "desk", "noir"]

selene_ns = cg.esphome_ns.namespace("selene")
SeleneClock = selene_ns.class_("SeleneClock", cg.Component)
SoundTrigger = selene_ns.class_("SoundTrigger", automation.Trigger.template(cg.std_string))
LightTrigger = selene_ns.class_("LightTrigger", automation.Trigger.template())
FaceTrigger = selene_ns.class_("FaceTrigger", automation.Trigger.template(cg.std_string))

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(SeleneClock),
        cv.Required(CONF_DISPLAY_ID): cv.use_id(display.Display),
        cv.Required(CONF_TIME_ID): cv.use_id(time_.RealTimeClock),
        cv.Optional(CONF_LATITUDE, default=40.7): cv.float_range(min=-89.0, max=89.0),
        cv.Optional(CONF_LONGITUDE, default=-74.0): cv.float_range(min=-180.0, max=180.0),
        cv.Optional(CONF_ROTATION, default=0): cv.one_of(0, 90, 180, 270, int=True),
        cv.Optional(CONF_DEFAULT_FACE, default="arc"): cv.one_of(*FACES, lower=True),
        cv.Optional(CONF_ON_SOUND): automation.validate_automation(
            {cv.GenerateID(CONF_TRIGGER_ID): cv.declare_id(SoundTrigger)}
        ),
        cv.Optional(CONF_ON_LIGHT): automation.validate_automation(
            {cv.GenerateID(CONF_TRIGGER_ID): cv.declare_id(LightTrigger)}
        ),
        cv.Optional(CONF_ON_FACE_CHANGE): automation.validate_automation(
            {cv.GenerateID(CONF_TRIGGER_ID): cv.declare_id(FaceTrigger)}
        ),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_display(await cg.get_variable(config[CONF_DISPLAY_ID])))
    cg.add(var.set_time(await cg.get_variable(config[CONF_TIME_ID])))
    cg.add(var.set_location(config[CONF_LATITUDE], config[CONF_LONGITUDE]))
    cg.add(var.set_rotation(config[CONF_ROTATION]))
    cg.add(var.set_default_face(config[CONF_DEFAULT_FACE]))
    for conf in config.get(CONF_ON_SOUND, []):
        trigger = cg.new_Pvariable(conf[CONF_TRIGGER_ID], var)
        await automation.build_automation(trigger, [(cg.std_string, "sound")], conf)
    for conf in config.get(CONF_ON_LIGHT, []):
        trigger = cg.new_Pvariable(conf[CONF_TRIGGER_ID], var)
        await automation.build_automation(trigger, [], conf)
    for conf in config.get(CONF_ON_FACE_CHANGE, []):
        trigger = cg.new_Pvariable(conf[CONF_TRIGGER_ID], var)
        await automation.build_automation(trigger, [(cg.std_string, "face")], conf)
