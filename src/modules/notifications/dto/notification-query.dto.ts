import { IsOptional, IsBoolean, IsNumber, IsString } from "class-validator";
import { Transform } from "class-transformer";

export class NotificationQueryDto {
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === "true")
  isRead?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  page?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number;
}
