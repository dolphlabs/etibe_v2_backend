import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  v2 as cloudinary,
  UploadApiResponse,
  UploadApiErrorResponse,
} from "cloudinary";

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>("cloudinary.cloudName"),
      api_key: this.configService.get<string>("cloudinary.apiKey"),
      api_secret: this.configService.get<string>("cloudinary.secret"),
    });
  }

  async uploadImage(
    file: Buffer,
    folder: string = "etibe",
    fileName?: string,
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    return new Promise((resolve, reject) => {
      const uploadOptions = {
        resource_type: "image" as const,
        folder,
        public_id: fileName ? fileName.split(".")[0] : undefined, // Remove extension if present
        use_filename: !!fileName,
        unique_filename: true,
      };

      cloudinary.uploader
        .upload_stream(uploadOptions, (error, result) => {
          if (error) {
            this.logger.error("Cloudinary upload failed", error);
            return reject(error);
          }
          if (!result) {
            this.logger.error("Cloudinary upload failed: No result");
            return reject(new Error("Cloudinary upload failed: No result"));
          }
          resolve(result);
        })
        .end(file);
    });
  }
}
