import {
  Controller,
  Post,
  Req,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { CloudinaryService } from "../services/cloudinary.service";

@Controller("utilities")
export class UtilitiesController {
  private readonly logger = new Logger(UtilitiesController.name);

  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Post("upload-image")
  async uploadImage(@Req() req: FastifyRequest) {
    if (!req.isMultipart()) {
      throw new BadRequestException("Request is not multipart");
    }

    const data = await req.file();
    if (!data) {
      throw new BadRequestException("No file uploaded");
    }

    if (!data.mimetype.startsWith("image/")) {
      throw new BadRequestException("Only image files are allowed");
    }

    try {
      const buffer = await data.toBuffer();
      const result = await this.cloudinaryService.uploadImage(
        buffer,
        "etibe",
        data.filename,
      );
      return {
        url: result.secure_url,
        public_id: result.public_id,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to upload image: ${errorMessage}`, errorStack);
      throw new BadRequestException("Failed to upload image");
    }
  }
}
