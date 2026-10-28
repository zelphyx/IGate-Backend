import { Controller, Param, ParseIntPipe, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { Roles } from '../common/decorators/roles.decorator';
import { ROLES } from '../common/constants';
import { JwtPayload } from '../common/interfaces/jwt-payload';

@ApiTags('admin-orders')
@ApiBearerAuth()
@Controller('admin/orders')
export class PaymentsAdminController {
  constructor(private readonly payments: PaymentsService) {}

  /** BR-11: konfirmasi lunas manual — superadmin saja. */
  @Roles(ROLES.SUPERADMIN)
  @Post(':id/verify-manual')
  verifyManual(@Param('id', ParseIntPipe) id: number, @Request() req: { user: JwtPayload }) {
    return this.payments.verifyManualOrder(id, { adminId: req.user.sub, email: req.user.email });
  }
}
